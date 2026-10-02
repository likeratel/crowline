pub mod aws;
pub mod bitbucket;
pub mod github;
pub mod vercel;

pub mod catalog;
pub mod cloud;
pub mod github_deployments;
pub mod hosting;
pub mod mobile;

/// Keep absent/blank execution names absent rather than inventing a workflow label.
fn execution_name(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::execution_name;
    #[test]
    fn missing_execution_names_are_not_invented() {
        assert_eq!(execution_name(None), None);
        assert_eq!(execution_name(Some(" \n\t ")), None);
        assert_eq!(
            execution_name(Some("  deploy-production  ")),
            Some("deploy-production".into())
        );
    }
}
