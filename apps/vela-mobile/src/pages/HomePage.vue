<template>
  <q-page class="q-pa-lg">
    <section class="due-review" aria-labelledby="due-review-heading">
      <h1 id="due-review-heading" class="text-h5 text-weight-bold">Today’s review</h1>

      <div
        v-if="view.kind === 'loading'"
        role="status"
        aria-live="polite"
        class="text-center q-py-xl"
      >
        <q-spinner size="40px" color="primary" />
        <p class="q-mt-md">
          {{ view.recoveringSession ? 'Refreshing your session…' : 'Loading your review count…' }}
        </p>
      </div>

      <template v-else-if="view.kind === 'zero' || view.kind === 'positive'">
        <p class="due-review__count" aria-live="polite">
          {{ view.kind === 'zero' ? 0 : view.count }}
        </p>
        <p aria-live="polite">
          {{
            view.kind === 'zero'
              ? 'You’re caught up for now.'
              : view.count === 1
                ? '1 word is due for review.'
                : `${view.count} words are due for review.`
          }}
        </p>
        <p v-if="view.refreshing" role="status" aria-live="polite">Refreshing review count…</p>
      </template>

      <div v-else role="alert">
        <template v-if="view.kind === 'cached_error'">
          <p class="due-review__count">{{ view.count }}</p>
        </template>
        <p>{{ view.message }}</p>
        <q-btn
          v-if="view.canRetry"
          color="primary"
          label="Retry"
          :loading="view.retrying"
          :disable="view.retrying"
          :aria-label="view.retrying ? 'Retrying review count' : 'Retry review count'"
          @click="retry"
        />
      </div>
    </section>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { selectDueReviewView } from 'src/components/home/due-review-view';
import { useDueReviewCount } from 'src/composables/useDueReviewCount';

const dueReview = useDueReviewCount();
const view = computed(() =>
  selectDueReviewView({
    stats: dueReview.stats.value,
    error: dueReview.error.value,
    isInitialPending: dueReview.isInitialPending.value,
    isFetching: dueReview.isFetching.value,
    sessionRecoveryPending: dueReview.sessionRecoveryPending.value,
    manualRetryPending: dueReview.manualRetryPending.value,
  }),
);
const retry = () => dueReview.retry();
</script>
