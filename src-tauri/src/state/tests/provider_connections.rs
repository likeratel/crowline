use super::*;
use crate::cloudflare_credentials::{self, CloudflareCredential};

fn credential(account_id: &str) -> CloudflareCredential {
    CloudflareCredential {
        account_id: account_id.into(),
        token: format!("fictional-token-{}", uuid::Uuid::new_v4()),
    }
}

#[tokio::test]
async fn cloudflare_token_stays_out_of_settings_and_renewal_preserves_account_binding() {
    let directory = test_directory("cloudflare-renewal");
    let state = test_state(&directory);
    let provider = Provider::CloudflarePages;
    let original = credential("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let account = state
        .connect_cloudflare(provider, original.clone(), None, &NoopPublisher)
        .await
        .unwrap();
    let persisted = std::fs::read_to_string(directory.join("settings.json")).unwrap();
    assert!(!persisted.contains(&original.token));
    assert!(state
        .connect_cloudflare(provider, original.clone(), None, &NoopPublisher)
        .await
        .is_err());
    assert!(state
        .connect_cloudflare(
            provider,
            credential("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
            Some(&account.id),
            &NoopPublisher,
        )
        .await
        .is_err());
    assert_eq!(
        cloudflare_credentials::get(provider, &account.id)
            .await
            .unwrap(),
        original
    );

    cloudflare_credentials::delete(provider, &account.id)
        .await
        .unwrap();
    let replacement = credential("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let renewed = state
        .connect_cloudflare(
            provider,
            replacement.clone(),
            Some(&account.id),
            &NoopPublisher,
        )
        .await
        .unwrap();
    assert_eq!(renewed, account);
    assert_eq!(
        cloudflare_credentials::get(provider, &account.id)
            .await
            .unwrap(),
        replacement
    );
    state
        .remove_connection(&account.id, &NoopPublisher)
        .await
        .unwrap();
    assert!(cloudflare_credentials::get(provider, &account.id)
        .await
        .is_err());
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn cloudflare_failed_save_cleans_up_new_token() {
    let directory = test_directory("cloudflare-create-rollback");
    std::fs::write(&directory, b"blocks directory creation").unwrap();
    let state = test_state(&directory);
    let credential = credential("cccccccccccccccccccccccccccccccc");
    assert!(state
        .connect_cloudflare(
            Provider::CloudflareWorkers,
            credential.clone(),
            None,
            &NoopPublisher
        )
        .await
        .is_err());
    assert_eq!(state.snapshot().await.settings, Settings::default());
    assert!(!cloudflare_credentials::test_contains_token(
        &credential.token
    ));
    let _ = std::fs::remove_file(directory);
}

#[tokio::test]
async fn cloudflare_failed_removal_restores_token_then_missing_token_allows_removal() {
    let directory = test_directory("cloudflare-remove-rollback");
    let state = test_state(&directory);
    let provider = Provider::CloudflareWorkers;
    let original = credential("dddddddddddddddddddddddddddddddd");
    let account = state
        .connect_cloudflare(provider, original.clone(), None, &NoopPublisher)
        .await
        .unwrap();
    std::fs::remove_file(directory.join("settings.json")).unwrap();
    std::fs::remove_dir(&directory).unwrap();
    std::fs::write(&directory, b"blocks directory recreation").unwrap();
    assert!(state
        .remove_connection(&account.id, &NoopPublisher)
        .await
        .is_err());
    assert!(state.snapshot().await.settings.accounts.contains(&account));
    assert_eq!(
        cloudflare_credentials::get(provider, &account.id)
            .await
            .unwrap(),
        original
    );
    std::fs::remove_file(&directory).unwrap();
    cloudflare_credentials::delete(provider, &account.id)
        .await
        .unwrap();
    state
        .remove_connection(&account.id, &NoopPublisher)
        .await
        .unwrap();
    assert!(!state.snapshot().await.settings.accounts.contains(&account));
    let _ = std::fs::remove_dir_all(directory);
}
