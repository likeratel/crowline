use super::*;

pub(super) fn validated_pipeline_next_page(
    next: Option<&str>,
    target: &Target,
) -> Result<Option<String>, String> {
    validate_target(target)?;
    let expected = [
        "repositories",
        target.metadata["workspace"].as_str(),
        target.metadata["repoSlug"].as_str(),
        "pipelines",
    ];
    let Some(next) = next else {
        return Ok(None);
    };
    let mut url =
        Url::parse(next).map_err(|_| "Bitbucket returned an invalid pagination URL.".to_owned())?;
    validate_api_url(&url)?;
    let segments: Vec<_> = url.path().trim_end_matches('/').split('/').collect();
    let repository_uuid = target
        .metadata
        .get("uuid")
        .and_then(|value| resource_uuid(value));
    let canonical_repository = segments.len() == 6
        && segments[0].is_empty()
        && segments[1] == "2.0"
        && segments[2] == "repositories"
        && resource_uuid(segments[3]).is_some()
        && repository_uuid.is_some()
        && resource_uuid(segments[4]) == repository_uuid
        && segments[5] == "pipelines";
    if canonical_repository {
        // Only consume the page number; requests still use the selected target's route.
        url.set_path(api_url(&expected, &[])?.path());
    }
    validated_next_page(Some(url.as_str()), &expected)
}

fn resource_uuid(value: &str) -> Option<uuid::Uuid> {
    let value = value
        .replace("%7B", "{")
        .replace("%7b", "{")
        .replace("%7D", "}")
        .replace("%7d", "}");
    uuid::Uuid::parse_str(&value).ok()
}

pub(super) fn validated_next_page(
    next: Option<&str>,
    expected_path: &[&str],
) -> Result<Option<String>, String> {
    let Some(next) = next else {
        return Ok(None);
    };
    let url =
        Url::parse(next).map_err(|_| "Bitbucket returned an invalid pagination URL.".to_owned())?;
    validate_api_url(&url)?;
    let expected = api_url(expected_path, &[])?.path().to_owned();
    if url.path().trim_end_matches('/') != expected.trim_end_matches('/') {
        return Err("Bitbucket returned pagination for an unexpected API path.".into());
    }
    let page = url
        .query_pairs()
        .find(|(key, _)| key == "page")
        .map(|(_, value)| value.into_owned())
        .ok_or_else(|| "Bitbucket returned pagination without a numeric page.".to_owned())?;
    parse_cursor(Some(&page)).map(|value| Some(value.to_string()))
}

pub(super) fn parse_cursor(cursor: Option<&str>) -> Result<u32, String> {
    match cursor {
        None => Ok(1),
        Some(value) => value
            .parse::<u32>()
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| "Invalid Bitbucket history cursor.".to_owned()),
    }
}
