use std::{sync::Mutex, time::Duration};

use tokio::sync::{MutexGuard, Notify};

#[derive(Default)]
struct RefreshWakeState {
    pending: bool,
    active_cycle: Option<u64>,
    next_cycle: u64,
    requested_while_active: bool,
}

#[derive(Default)]
pub(super) struct RefreshWake {
    state: Mutex<RefreshWakeState>,
    notify: Notify,
}

impl RefreshWake {
    pub(super) fn request(&self) {
        let should_notify = {
            let mut state = self.state.lock().expect("refresh wake lock poisoned");
            if state.active_cycle.is_some() {
                state.requested_while_active = true;
                false
            } else if state.pending {
                false
            } else {
                state.pending = true;
                true
            }
        };
        if should_notify {
            self.notify.notify_one();
        }
    }

    pub(super) fn begin<'a>(&'a self, refresh_guard: MutexGuard<'a, ()>) -> RefreshCycle<'a> {
        let mut state = self.state.lock().expect("refresh wake lock poisoned");
        state.pending = false;
        state.next_cycle = state.next_cycle.wrapping_add(1);
        let cycle = state.next_cycle;
        state.active_cycle = Some(cycle);
        state.requested_while_active = false;
        RefreshCycle {
            wake: self,
            cycle,
            refresh_guard: Some(refresh_guard),
            finished: false,
        }
    }

    pub(super) fn take_pending(&self) -> bool {
        let mut state = self.state.lock().expect("refresh wake lock poisoned");
        std::mem::take(&mut state.pending)
    }

    pub(super) async fn wait(&self, duration: Duration) -> bool {
        if self.take_pending() {
            return true;
        }
        let deadline = tokio::time::Instant::now() + duration;
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(deadline) => return self.take_pending(),
                _ = self.notify.notified() => {
                    if self.take_pending() {
                        return true;
                    }
                }
            }
        }
    }
}

pub(super) struct RefreshCycle<'a> {
    wake: &'a RefreshWake,
    cycle: u64,
    refresh_guard: Option<MutexGuard<'a, ()>>,
    finished: bool,
}

impl RefreshCycle<'_> {
    pub(super) fn finish(mut self, needs_followup: bool) {
        drop(self.refresh_guard.take());
        self.complete(needs_followup);
        self.finished = true;
    }

    fn complete(&self, needs_followup: bool) {
        let should_notify = {
            let mut state = self.wake.state.lock().expect("refresh wake lock poisoned");
            if state.active_cycle != Some(self.cycle) {
                return;
            }
            state.active_cycle = None;
            let requested = std::mem::take(&mut state.requested_while_active);
            if requested && needs_followup && !state.pending {
                state.pending = true;
                true
            } else {
                false
            }
        };
        if should_notify {
            self.wake.notify.notify_one();
        }
    }
}

impl Drop for RefreshCycle<'_> {
    fn drop(&mut self) {
        if !self.finished {
            drop(self.refresh_guard.take());
            self.complete(true);
        }
    }
}
