use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use futures::{stream, StreamExt};

use crate::models::{Activity, ActivityPage, Issue, Target};

use super::{
    activity_id, amplify, cluster_name, service_name,
    support::{
        cloudformation_operation_id, friendly_aws_error, is_selected_stack_event, load_config,
        normalize_cloudformation_status, normalize_ecs_status, ownership_from_observed_actor,
        partial_issue, record_latest_stack_operation, rfc3339,
        should_collect_cloudformation_operation, should_collect_ecs_deployment, target_issue,
        target_metadata, terminal_time, AwsTargetMetadata,
    },
    AMPLIFY_BRANCH, AWS_PROVIDER, CALL_TIMEOUT, CLOUD_FORMATION_STACK, ECS_SERVICE,
    MAX_COLLECT_TARGETS,
};

const MAX_CONCURRENT_TARGETS: usize = 4;
const MAX_CURSOR_LENGTH: usize = 4096;
const MAX_HISTORY_HOURS: u32 = 168;
const CLIENT_CACHE_TTL: Duration = Duration::from_secs(60);

type ClientKey = (String, String);
type ClientSlots = BTreeMap<ClientKey, Arc<ClientSlot>>;

static CLIENT_SLOTS: OnceLock<Mutex<ClientSlots>> = OnceLock::new();

#[derive(Clone)]
struct AwsClients {
    cloudformation: aws_sdk_cloudformation::Client,
    ecs: aws_sdk_ecs::Client,
    amplify: aws_sdk_amplify::Client,
}

struct ClientSlot {
    clients: Mutex<Option<CachedClients>>,
    loading: tokio::sync::Mutex<()>,
}

struct CachedClients {
    clients: Arc<AwsClients>,
    loaded_at: Instant,
}

impl ClientSlot {
    fn new() -> Self {
        Self {
            clients: Mutex::new(None),
            loading: tokio::sync::Mutex::new(()),
        }
    }

    fn current(&self) -> Option<Arc<AwsClients>> {
        let mut cached = self
            .clients
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if cached
            .as_ref()
            .is_some_and(|value| value.loaded_at.elapsed() > CLIENT_CACHE_TTL)
        {
            *cached = None;
        }
        cached.as_ref().map(|value| value.clients.clone())
    }

    fn store(&self, clients: &Arc<AwsClients>) {
        *self
            .clients
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(CachedClients {
            clients: clients.clone(),
            loaded_at: Instant::now(),
        });
    }
}

impl AwsClients {
    fn from_config(config: &aws_types::SdkConfig) -> Self {
        Self {
            cloudformation: aws_sdk_cloudformation::Client::new(config),
            ecs: aws_sdk_ecs::Client::new(config),
            amplify: aws_sdk_amplify::Client::new(config),
        }
    }

    async fn load(profile: &str, region: &str) -> Self {
        let config = load_config(profile, region).await;
        Self::from_config(&config)
    }
}

fn client_slot(profile: &str, region: &str) -> Arc<ClientSlot> {
    let key = (profile.to_owned(), region.to_owned());
    let slots = CLIENT_SLOTS.get_or_init(|| Mutex::new(BTreeMap::new()));
    let mut slots = slots
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    slots
        .entry(key)
        .or_insert_with(|| Arc::new(ClientSlot::new()))
        .clone()
}

pub(super) fn seed_clients(profile: &str, region: &str, config: &aws_types::SdkConfig) {
    let clients = Arc::new(AwsClients::from_config(config));
    client_slot(profile, region).store(&clients);
}

async fn shared_clients(profile: &str, region: &str) -> Arc<AwsClients> {
    let slot = client_slot(profile, region);
    if let Some(clients) = slot.current() {
        return clients;
    }
    let _loading = slot.loading.lock().await;
    if let Some(clients) = slot.current() {
        return clients;
    }
    let clients = Arc::new(AwsClients::load(profile, region).await);
    slot.store(&clients);
    clients
}

/// Collects one recent service page per target without changing AWS resources.
pub async fn collect(targets: &[Target], history_hours: u32) -> (Vec<Activity>, Vec<Issue>) {
    let connection_id = targets
        .iter()
        .find(|target| target.provider == AWS_PROVIDER)
        .map(|target| target.connection_id.as_str())
        .unwrap_or("");
    if let Err(message) = validate_history_hours(history_hours, "activity") {
        return (Vec::new(), vec![partial_issue(connection_id, message)]);
    }

    let (prepared, mut issues) = prepare_targets(targets, connection_id);
    let clients = load_client_cache(&prepared).await;
    let cutoff = Utc::now() - ChronoDuration::hours(i64::from(history_hours));
    let results = stream::iter(prepared.into_iter().filter_map(|target| {
        let metadata = target_metadata(&target).ok()?;
        let key = client_key(&metadata);
        let clients = clients.get(&key)?.clone();
        Some(async move {
            let result = page_with_clients(&clients, &target, None, cutoff).await;
            (target, result)
        })
    }))
    .buffer_unordered(MAX_CONCURRENT_TARGETS)
    .collect::<Vec<_>>()
    .await;

    let mut activities = Vec::new();
    for (target, result) in results {
        match result {
            Ok(mut result_page) => {
                if result_page.next_cursor.is_some() {
                    result_page.issues.push(target_issue(
                        &target,
                        truncation_message(target_metadata(&target).map(|value| value.kind).ok()),
                    ));
                }
                activities.append(&mut result_page.activities);
                issues.append(&mut result_page.issues);
            }
            Err(message) => issues.push(target_issue(&target, message)),
        }
    }
    activities.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    issues.sort_by(|left, right| {
        left.target_id
            .cmp(&right.target_id)
            .then_with(|| left.message.cmp(&right.message))
    });
    (activities, issues)
}

fn prepare_targets(targets: &[Target], connection_id: &str) -> (Vec<Target>, Vec<Issue>) {
    let aws_targets = targets
        .iter()
        .filter(|target| target.provider == AWS_PROVIDER)
        .take(MAX_COLLECT_TARGETS)
        .cloned()
        .collect::<Vec<_>>();
    let mut issues = Vec::new();
    if targets
        .iter()
        .filter(|target| target.provider == AWS_PROVIDER)
        .count()
        > MAX_COLLECT_TARGETS
    {
        issues.push(partial_issue(
            connection_id,
            "AWS activity collection reached its 100-target limit; some selected targets were skipped.",
        ));
    }
    let prepared = aws_targets
        .into_iter()
        .filter_map(|target| match target_metadata(&target) {
            Ok(_) => Some(target),
            Err(message) => {
                issues.push(target_issue(&target, message));
                None
            }
        })
        .collect();
    (prepared, issues)
}

async fn load_client_cache(targets: &[Target]) -> BTreeMap<ClientKey, Arc<AwsClients>> {
    let keys = targets
        .iter()
        .filter_map(|target| target_metadata(target).ok())
        .map(|metadata| client_key(&metadata))
        .collect::<std::collections::BTreeSet<_>>();
    stream::iter(keys)
        .map(|(profile, region)| async move {
            let clients = shared_clients(&profile, &region).await;
            ((profile, region), clients)
        })
        .buffer_unordered(MAX_CONCURRENT_TARGETS)
        .collect()
        .await
}

fn client_key(metadata: &AwsTargetMetadata<'_>) -> ClientKey {
    (metadata.profile.to_owned(), metadata.region.to_owned())
}

/// Loads one recent or paginated page for a single AWS target.
pub async fn page(
    target: &Target,
    cursor: Option<&str>,
    history_hours: u32,
) -> Result<ActivityPage, String> {
    if target.provider != AWS_PROVIDER {
        return Err("AWS history can only load an AWS target.".into());
    }
    let metadata = target_metadata(target)?;
    validate_history_hours(history_hours, service_label(metadata.kind))?;
    let cursor = parse_cursor(metadata.kind, cursor)?;
    let clients = shared_clients(metadata.profile, metadata.region).await;
    let cutoff = Utc::now() - ChronoDuration::hours(i64::from(history_hours));
    page_with_clients(&clients, target, cursor, cutoff).await
}

async fn page_with_clients(
    clients: &AwsClients,
    target: &Target,
    cursor: Option<String>,
    cutoff: DateTime<Utc>,
) -> Result<ActivityPage, String> {
    let metadata = target_metadata(target)?;
    match metadata.kind {
        CLOUD_FORMATION_STACK => {
            cloudformation_page(&clients.cloudformation, target, &metadata, cursor, cutoff).await
        }
        ECS_SERVICE => ecs_page(&clients.ecs, target, &metadata, cursor, cutoff).await,
        AMPLIFY_BRANCH => {
            amplify::jobs_page(&clients.amplify, target, &metadata, cursor, cutoff).await
        }
        _ => Err("AWS target type is not supported.".into()),
    }
}

fn validate_history_hours(history_hours: u32, service: &str) -> Result<(), String> {
    if (1..=MAX_HISTORY_HOURS).contains(&history_hours) {
        Ok(())
    } else {
        Err(format!(
            "AWS {service} history supports 1 through {MAX_HISTORY_HOURS} hours."
        ))
    }
}

fn parse_cursor(kind: &str, cursor: Option<&str>) -> Result<Option<String>, String> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    if kind == ECS_SERVICE {
        return Err(
            "ECS exposes only its current deployment set and does not support history cursors."
                .into(),
        );
    }
    let prefix = match kind {
        CLOUD_FORMATION_STACK => "cloudformation:",
        AMPLIFY_BRANCH => "amplify:",
        _ => return Err("AWS target type is not supported.".into()),
    };
    let token = cursor
        .strip_prefix(prefix)
        .filter(|token| {
            !token.is_empty()
                && token.len() <= MAX_CURSOR_LENGTH
                && !token.chars().any(char::is_control)
        })
        .ok_or_else(|| format!("AWS {} history cursor is invalid.", service_label(kind)))?;
    Ok(Some(token.to_owned()))
}

async fn cloudformation_page(
    client: &aws_sdk_cloudformation::Client,
    target: &Target,
    metadata: &AwsTargetMetadata<'_>,
    cursor: Option<String>,
    cutoff: DateTime<Utc>,
) -> Result<ActivityPage, String> {
    let stack = metadata
        .stack
        .ok_or_else(|| "CloudFormation target is missing its stack name.".to_owned())?;
    let mut request = client.describe_stack_events().stack_name(stack);
    if let Some(token) = cursor {
        request = request.next_token(token);
    }
    let output = match tokio::time::timeout(CALL_TIMEOUT, request.send()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return Err(friendly_aws_error(
                "CloudFormation event lookup",
                &error.to_string(),
            ))
        }
        Err(_) => return Err("AWS CloudFormation event lookup timed out.".into()),
    };
    Ok(map_cloudformation_page(target, metadata, output, cutoff))
}

fn map_cloudformation_page(
    target: &Target,
    metadata: &AwsTargetMetadata<'_>,
    output: aws_sdk_cloudformation::operation::describe_stack_events::DescribeStackEventsOutput,
    cutoff: DateTime<Utc>,
) -> ActivityPage {
    let stack = metadata.stack.unwrap_or_default();
    let mut seen_operations = std::collections::HashSet::new();
    let mut activities = Vec::new();
    let mut issues = Vec::new();
    let mut reached_cutoff = false;
    for event in output.stack_events() {
        if !is_root_stack_event(stack, metadata.stack_id, event) {
            continue;
        }
        let Some(timestamp) = event
            .timestamp()
            .and_then(|time| time.to_millis().ok())
            .and_then(rfc3339)
        else {
            issues.push(target_issue(
                target,
                "CloudFormation returned a root event without a valid timestamp; some activity was skipped.",
            ));
            continue;
        };
        let older = timestamp_is_older(&timestamp, cutoff);
        if let Some(activity) = map_stack_event(
            target,
            metadata,
            event,
            &timestamp,
            cutoff,
            &mut seen_operations,
        ) {
            activities.push(activity);
        }
        if older {
            reached_cutoff = true;
            break;
        }
    }
    ActivityPage {
        activities,
        next_cursor: (!reached_cutoff)
            .then(|| {
                output
                    .next_token()
                    .map(|token| format!("cloudformation:{token}"))
            })
            .flatten(),
        issues,
    }
}

fn is_root_stack_event(
    stack: &str,
    stack_id: Option<&str>,
    event: &aws_sdk_cloudformation::types::StackEvent,
) -> bool {
    event.resource_type() == Some("AWS::CloudFormation::Stack")
        && is_selected_stack_event(
            stack,
            stack_id,
            event.stack_name(),
            event.logical_resource_id(),
            event.physical_resource_id(),
        )
}

fn map_stack_event(
    target: &Target,
    metadata: &AwsTargetMetadata<'_>,
    event: &aws_sdk_cloudformation::types::StackEvent,
    timestamp: &str,
    cutoff: DateTime<Utc>,
    seen_operations: &mut std::collections::HashSet<String>,
) -> Option<Activity> {
    let stack = metadata.stack?;
    let raw_status = event
        .resource_status()
        .map(|status| status.as_str().to_owned())
        .unwrap_or_else(|| "UNKNOWN".into());
    let status = normalize_cloudformation_status(&raw_status);
    let operation_id =
        cloudformation_operation_id(stack, event.operation_id(), event.client_request_token());
    if !record_latest_stack_operation(seen_operations, &operation_id)
        || !should_collect_cloudformation_operation(status, timestamp, cutoff)
    {
        return None;
    }
    Some(Activity {
        id: activity_id(&[target.id.as_str(), "cloudformation", &operation_id]),
        target_id: target.id.clone(),
        provider: AWS_PROVIDER,
        connection_id: target.connection_id.clone(),
        workflow_name: None,
        kind: "cloudformation".into(),
        title: format!("CloudFormation stack {stack}"),
        project: target.name.clone(),
        branch: None,
        url: cloudformation_console_url(metadata.region, stack),
        status,
        raw_status,
        actor: None,
        ownership: ownership_from_observed_actor(None),
        started_at: timestamp.into(),
        finished_at: terminal_time(status, timestamp),
        updated_at: timestamp.into(),
    })
}

async fn ecs_page(
    client: &aws_sdk_ecs::Client,
    target: &Target,
    metadata: &AwsTargetMetadata<'_>,
    cursor: Option<String>,
    cutoff: DateTime<Utc>,
) -> Result<ActivityPage, String> {
    if cursor.is_some() {
        return Err(
            "ECS exposes only its current deployment set and does not support history cursors."
                .into(),
        );
    }
    let (Some(cluster), Some(service)) = (metadata.cluster, metadata.service) else {
        return Err("ECS target is missing its cluster or service identifier.".into());
    };
    let output = match tokio::time::timeout(
        CALL_TIMEOUT,
        client
            .describe_services()
            .cluster(cluster)
            .services(service)
            .send(),
    )
    .await
    {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return Err(friendly_aws_error(
                "ECS deployment lookup",
                &error.to_string(),
            ))
        }
        Err(_) => return Err("AWS ECS deployment lookup timed out.".into()),
    };
    Ok(map_ecs_page(target, metadata, output, cutoff))
}

fn map_ecs_page(
    target: &Target,
    metadata: &AwsTargetMetadata<'_>,
    output: aws_sdk_ecs::operation::describe_services::DescribeServicesOutput,
    cutoff: DateTime<Utc>,
) -> ActivityPage {
    let mut activities = Vec::new();
    let mut issues = Vec::new();
    if !output.failures().is_empty() {
        issues.push(target_issue(
            target,
            "ECS did not describe every requested service.",
        ));
    }
    for service_detail in output.services() {
        for deployment in service_detail.deployments() {
            match map_ecs_deployment(target, metadata, deployment, cutoff) {
                Ok(Some(activity)) => activities.push(activity),
                Ok(None) => {}
                Err(message) => issues.push(target_issue(target, message)),
            }
        }
    }
    ActivityPage {
        activities,
        next_cursor: None,
        issues,
    }
}

fn map_ecs_deployment(
    target: &Target,
    metadata: &AwsTargetMetadata<'_>,
    deployment: &aws_sdk_ecs::types::Deployment,
    cutoff: DateTime<Utc>,
) -> Result<Option<Activity>, String> {
    let (Some(cluster), Some(service)) = (metadata.cluster, metadata.service) else {
        return Err("ECS target is missing its cluster or service identifier.".into());
    };
    let created_at = deployment
        .created_at()
        .and_then(|time| time.to_millis().ok())
        .and_then(rfc3339)
        .ok_or_else(|| "ECS returned a deployment without a valid creation time.".to_owned())?;
    let raw_status = deployment
        .rollout_state()
        .map(|state| state.as_str().to_owned())
        .unwrap_or_else(|| "UNKNOWN".into());
    let status = normalize_ecs_status(&raw_status);
    let updated_at = deployment
        .updated_at()
        .and_then(|time| time.to_millis().ok())
        .and_then(rfc3339)
        .unwrap_or_else(|| created_at.clone());
    if !should_collect_ecs_deployment(status, &updated_at, cutoff) {
        return Ok(None);
    }
    let deployment_id = deployment
        .id()
        .map(str::to_owned)
        .unwrap_or_else(|| activity_id(&[cluster, service, &created_at, &raw_status]));
    Ok(Some(Activity {
        id: deployment_id,
        target_id: target.id.clone(),
        provider: AWS_PROVIDER,
        connection_id: target.connection_id.clone(),
        workflow_name: None,
        kind: "ecs".into(),
        title: format!("ECS service {}", service_name(service)),
        project: target.name.clone(),
        branch: None,
        url: ecs_console_url(metadata.region, cluster, service),
        status,
        raw_status,
        actor: None,
        ownership: ownership_from_observed_actor(None),
        started_at: created_at,
        finished_at: terminal_time(status, &updated_at),
        updated_at,
    }))
}

fn truncation_message(kind: Option<&str>) -> &'static str {
    match kind {
        Some(CLOUD_FORMATION_STACK) => {
            "CloudFormation returned more events than the newest service page; use history pagination to load older operations."
        }
        Some(AMPLIFY_BRANCH) => {
            "Amplify returned more than 20 jobs; use history pagination to load older jobs, including any long-running job outside the newest page."
        }
        _ => "AWS returned more activity; use history pagination to load older results.",
    }
}

fn service_label(kind: &str) -> &'static str {
    match kind {
        CLOUD_FORMATION_STACK => "CloudFormation",
        ECS_SERVICE => "ECS",
        AMPLIFY_BRANCH => "Amplify",
        _ => "activity",
    }
}

fn timestamp_is_older(timestamp: &str, cutoff: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(timestamp)
        .map(|value| value.with_timezone(&Utc) < cutoff)
        .unwrap_or(false)
}

fn cloudformation_console_url(region: &str, stack: &str) -> String {
    format!(
        "https://{region}.console.aws.amazon.com/cloudformation/home?region={region}#/stacks/events?stackId={}",
        url::form_urlencoded::byte_serialize(stack.as_bytes()).collect::<String>()
    )
}

fn ecs_console_url(region: &str, cluster: &str, service: &str) -> String {
    let cluster =
        url::form_urlencoded::byte_serialize(cluster_name(cluster).as_bytes()).collect::<String>();
    let service =
        url::form_urlencoded::byte_serialize(service_name(service).as_bytes()).collect::<String>();
    format!("https://{region}.console.aws.amazon.com/ecs/v2/clusters/{cluster}/services/{service}/deployments?region={region}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::aws::support::{cloudformation_target, target_metadata};

    #[test]
    fn validates_service_scoped_cursors_and_history_limits() {
        assert_eq!(
            parse_cursor(CLOUD_FORMATION_STACK, Some("cloudformation:token-1")).expect("cursor"),
            Some("token-1".into())
        );
        assert!(parse_cursor(CLOUD_FORMATION_STACK, Some("amplify:token-1")).is_err());
        assert!(parse_cursor(ECS_SERVICE, Some("ecs:anything")).is_err());
        assert!(validate_history_hours(1, "CloudFormation").is_ok());
        assert!(validate_history_hours(168, "CloudFormation").is_ok());
        assert!(validate_history_hours(0, "CloudFormation").is_err());
        assert!(validate_history_hours(169, "CloudFormation").is_err());
    }

    #[test]
    fn cutoff_is_strict_so_the_exact_boundary_is_retained() {
        let cutoff = DateTime::parse_from_rfc3339("2026-09-29T00:00:00Z")
            .expect("cutoff")
            .with_timezone(&Utc);
        assert!(!timestamp_is_older("2026-09-29T00:00:00Z", cutoff));
        assert!(timestamp_is_older("2026-09-28T23:59:59Z", cutoff));
    }

    #[test]
    fn cloudformation_keeps_an_old_current_operation_and_stops_older_history() {
        let stack_id = "arn:aws:cloudformation:us-east-1:123456789012:stack/example/id";
        let target = cloudformation_target(
            "aws-example",
            "engineering",
            "us-east-1",
            "example",
            Some(stack_id),
        );
        let metadata = target_metadata(&target).expect("metadata");
        let event = aws_sdk_cloudformation::types::StackEvent::builder()
            .stack_name("example")
            .logical_resource_id("example")
            .physical_resource_id(stack_id)
            .resource_type("AWS::CloudFormation::Stack")
            .operation_id("operation-current")
            .timestamp(aws_sdk_cloudformation::primitives::DateTime::from_secs(
                1_799_625_600,
            ))
            .resource_status(aws_sdk_cloudformation::types::ResourceStatus::UpdateInProgress)
            .build();
        let output = aws_sdk_cloudformation::operation::describe_stack_events::DescribeStackEventsOutput::builder()
            .stack_events(event)
            .next_token("older-page")
            .build();
        let cutoff = DateTime::parse_from_rfc3339("2027-01-12T00:00:00Z")
            .expect("cutoff")
            .with_timezone(&Utc);

        let page = map_cloudformation_page(&target, &metadata, output, cutoff);

        assert_eq!(page.activities.len(), 1);
        assert_eq!(
            page.activities[0].status,
            crate::models::ActivityStatus::Running
        );
        assert_eq!(page.next_cursor, None);
        assert!(page.issues.is_empty());
    }
}
