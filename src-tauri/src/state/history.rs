use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};

use crate::models::{Provider, Target, TargetHistory};

const SESSION_TTL: Duration = Duration::minutes(30);

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct HistoryKey {
    provider: Provider,
    connection_id: String,
    target_id: String,
}

impl HistoryKey {
    fn from_target(target: &Target) -> Self {
        Self {
            provider: target.provider,
            connection_id: target.connection_id.clone(),
            target_id: target.id.clone(),
        }
    }

    fn target_key(&self) -> String {
        format!(
            "{}:{}:{}",
            self.provider.as_str(),
            self.connection_id,
            self.target_id
        )
    }
}

#[derive(Debug)]
struct HistorySession {
    generation: u64,
    next_cursor: Option<String>,
    loaded_ids: HashSet<String>,
    settings_revision: u64,
    touched_at: DateTime<Utc>,
    has_loaded: bool,
    inflight: bool,
    needs_reset: bool,
}

#[derive(Debug)]
pub(super) struct RecentHistory {
    pub(super) entry: TargetHistory,
    pub(super) loaded_ids: HashSet<String>,
}

#[derive(Debug, Default)]
pub(super) struct HistoryCache {
    sessions: HashMap<HistoryKey, HistorySession>,
    next_generation: u64,
}

impl HistoryCache {
    pub(super) fn recent(
        &mut self,
        target: &Target,
        settings_revision: u64,
        next_cursor: Option<String>,
        now: DateTime<Utc>,
    ) -> RecentHistory {
        let key = HistoryKey::from_target(target);
        let reset = self.sessions.get(&key).is_none_or(|session| {
            session.settings_revision != settings_revision
                || session.needs_reset
                || expired(session, now)
        });
        if reset {
            let previous = self.sessions.remove(&key);
            let preserve_loaded = previous.as_ref().is_some_and(|session| {
                session.settings_revision == settings_revision
                    && session.needs_reset
                    && !expired(session, now)
            });
            let loaded_ids = previous
                .filter(|_| preserve_loaded)
                .map(|session| session.loaded_ids)
                .unwrap_or_default();
            let generation = self.allocate_generation();
            self.sessions.insert(
                key.clone(),
                HistorySession {
                    generation,
                    next_cursor,
                    loaded_ids,
                    settings_revision,
                    touched_at: now,
                    has_loaded: false,
                    inflight: false,
                    needs_reset: false,
                },
            );
        } else {
            let tracks_stale_first_page = self.sessions.get(&key).is_some_and(|session| {
                !session.has_loaded && !session.inflight && session.next_cursor != next_cursor
            });
            if tracks_stale_first_page {
                let generation = self.allocate_generation();
                let session = self
                    .sessions
                    .get_mut(&key)
                    .expect("history session already checked");
                session.generation = generation;
                session.next_cursor = next_cursor;
                session.touched_at = now;
            }
        }
        let session = self.sessions.get(&key).expect("history session inserted");
        RecentHistory {
            entry: entry(target, session, now),
            loaded_ids: session.loaded_ids.clone(),
        }
    }

    pub(super) fn begin_load(
        &mut self,
        target: &Target,
        cursor: &str,
        generation: u64,
        settings_revision: u64,
        now: DateTime<Utc>,
    ) -> bool {
        let Some(session) = self.sessions.get_mut(&HistoryKey::from_target(target)) else {
            return false;
        };
        if expired(session, now) {
            session.needs_reset = true;
            return false;
        }
        let accepted = !session.needs_reset
            && session.settings_revision == settings_revision
            && session.generation == generation
            && session.next_cursor.as_deref() == Some(cursor)
            && !session.inflight;
        if accepted {
            session.inflight = true;
        }
        accepted
    }

    pub(super) fn accepts_inflight(
        &mut self,
        target: &Target,
        cursor: &str,
        generation: u64,
        settings_revision: u64,
        now: DateTime<Utc>,
    ) -> bool {
        let Some(session) = self.sessions.get_mut(&HistoryKey::from_target(target)) else {
            return false;
        };
        if expired(session, now) {
            session.inflight = false;
            session.needs_reset = true;
            return false;
        }
        session.inflight
            && !session.needs_reset
            && session.settings_revision == settings_revision
            && session.generation == generation
            && session.next_cursor.as_deref() == Some(cursor)
    }

    pub(super) fn commit(
        &mut self,
        target: &Target,
        generation: u64,
        loaded_ids: impl IntoIterator<Item = String>,
        next_cursor: Option<String>,
        now: DateTime<Utc>,
    ) -> Option<TargetHistory> {
        let session = self.sessions.get_mut(&HistoryKey::from_target(target))?;
        if session.generation != generation || session.needs_reset || !session.inflight {
            return None;
        }
        session.loaded_ids.extend(loaded_ids);
        session.next_cursor = next_cursor;
        session.touched_at = now;
        session.has_loaded = true;
        session.inflight = false;
        Some(entry(target, session, now))
    }

    pub(super) fn replace_loaded_ids(&mut self, target: &Target, loaded_ids: HashSet<String>) {
        if let Some(session) = self.sessions.get_mut(&HistoryKey::from_target(target)) {
            session.loaded_ids = loaded_ids;
        }
    }

    pub(super) fn mark_failed(&mut self, target: &Target, cursor: &str, generation: u64) {
        if let Some(session) = self.sessions.get_mut(&HistoryKey::from_target(target)) {
            if session.generation == generation && session.next_cursor.as_deref() == Some(cursor) {
                session.inflight = false;
                session.needs_reset = true;
            }
        }
    }

    pub(super) fn needs_followup(&self) -> bool {
        self.sessions.values().any(|session| session.needs_reset)
    }

    pub(super) fn remove_connection(&mut self, connection_id: &str) {
        self.sessions
            .retain(|key, _| key.connection_id != connection_id);
    }

    pub(super) fn retain_target_keys(
        &mut self,
        retained: &HashSet<String>,
        settings_revision: u64,
    ) {
        self.sessions.retain(|key, session| {
            let keep = retained.contains(&key.target_key());
            if keep {
                session.settings_revision = settings_revision;
            }
            keep
        });
    }

    fn allocate_generation(&mut self) -> u64 {
        self.next_generation = self.next_generation.wrapping_add(1).max(1);
        self.next_generation
    }
}

fn expired(session: &HistorySession, now: DateTime<Utc>) -> bool {
    now.signed_duration_since(session.touched_at) >= SESSION_TTL
}

fn entry(target: &Target, session: &HistorySession, now: DateTime<Utc>) -> TargetHistory {
    TargetHistory {
        provider: target.provider,
        connection_id: target.connection_id.clone(),
        target_id: target.id.clone(),
        next_cursor: session.next_cursor.clone(),
        checked_at: now.to_rfc3339(),
        generation: session.generation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn target() -> Target {
        Target {
            id: "sample/repository".into(),
            provider: Provider::Github,
            connection_id: "github:local".into(),
            name: "Repository".into(),
            description: None,
            metadata: HashMap::new(),
        }
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-06T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn unused_cursor_tracks_recent_until_a_load_starts_then_preserves_the_chain() {
        let target = target();
        let mut cache = HistoryCache::default();
        let empty = cache.recent(&target, 3, None, now());
        let first = cache.recent(&target, 3, Some("2".into()), now() + Duration::seconds(10));
        assert_ne!(first.entry.generation, empty.entry.generation);
        let moved = cache.recent(
            &target,
            3,
            Some("new-provider-cursor".into()),
            now() + Duration::seconds(20),
        );
        assert_ne!(moved.entry.generation, first.entry.generation);
        assert!(cache.begin_load(
            &target,
            "new-provider-cursor",
            moved.entry.generation,
            3,
            now() + Duration::seconds(20)
        ));
        let interleaved_poll = cache.recent(
            &target,
            3,
            Some("newest-provider-cursor".into()),
            now() + Duration::seconds(30),
        );
        assert_eq!(interleaved_poll.entry.generation, moved.entry.generation);
        assert_eq!(
            interleaved_poll.entry.next_cursor.as_deref(),
            Some("new-provider-cursor")
        );
        assert!(cache.accepts_inflight(
            &target,
            "new-provider-cursor",
            moved.entry.generation,
            3,
            now() + Duration::seconds(30)
        ));
        let loaded = cache
            .commit(
                &target,
                moved.entry.generation,
                ["older".into()],
                Some("3".into()),
                now(),
            )
            .unwrap();
        let recent = cache.recent(
            &target,
            3,
            Some("another-provider-cursor".into()),
            now() + Duration::minutes(1),
        );

        assert_eq!(recent.entry.generation, loaded.generation);
        assert_eq!(recent.entry.next_cursor.as_deref(), Some("3"));
        assert!(recent.loaded_ids.contains("older"));
        assert!(cache.begin_load(
            &target,
            "3",
            loaded.generation,
            3,
            now() + Duration::minutes(1)
        ));
    }

    #[test]
    fn failed_or_expired_chains_reset_without_accepting_stale_cursors() {
        let target = target();
        let mut cache = HistoryCache::default();
        let first = cache.recent(&target, 1, Some("2".into()), now()).entry;
        assert!(cache.begin_load(&target, "2", first.generation, 1, now()));
        cache
            .commit(
                &target,
                first.generation,
                ["older".into()],
                Some("3".into()),
                now(),
            )
            .unwrap();
        cache.mark_failed(&target, "3", first.generation);
        assert!(!cache.begin_load(&target, "3", first.generation, 1, now()));

        let reset = cache.recent(
            &target,
            1,
            Some("fresh".into()),
            now() + Duration::minutes(1),
        );
        assert_ne!(reset.entry.generation, first.generation);
        assert!(reset.loaded_ids.contains("older"));
        assert!(!cache.begin_load(
            &target,
            "fresh",
            reset.entry.generation,
            1,
            now() + Duration::minutes(31),
        ));
        let expired = cache.recent(
            &target,
            1,
            Some("after-ttl".into()),
            now() + Duration::minutes(31),
        );
        assert!(expired.loaded_ids.is_empty());
    }

    #[test]
    fn settings_pruning_keeps_only_unchanged_target_chains() {
        let first = target();
        let second = Target {
            id: "sample/other".into(),
            ..target()
        };
        let mut cache = HistoryCache::default();
        let first_page = cache.recent(&first, 1, Some("first".into()), now()).entry;
        let second_page = cache.recent(&second, 1, Some("second".into()), now()).entry;
        assert!(cache.begin_load(&first, "first", first_page.generation, 1, now()));
        cache.retain_target_keys(&HashSet::from([first.key()]), 2);

        assert!(cache.accepts_inflight(&first, "first", first_page.generation, 2, now()));
        assert!(!cache.begin_load(&second, "second", second_page.generation, 2, now()));
    }
}
