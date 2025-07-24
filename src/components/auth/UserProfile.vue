<template>
  <q-card class="user-profile">
    <q-card-section class="text-center bg-primary text-white">
      <q-avatar size="80px" class="q-mb-md">
        <img
          v-if="authStore.user?.avatar_url"
          :src="authStore.user.avatar_url"
          :alt="authStore.userName"
        />
        <q-icon v-else name="person" size="40px" />
      </q-avatar>

      <div class="text-h6">{{ authStore.userName }}</div>
      <div class="text-subtitle2 text-blue-2">
        {{ authStore.user?.email }}
      </div>

      <!-- Level and Experience -->
      <div class="row q-mt-md q-gutter-md justify-center">
        <div class="col-auto text-center">
          <div class="text-h4">{{ authStore.userLevel }}</div>
          <div class="text-caption">Level</div>
        </div>
        <div class="col-auto text-center">
          <div class="text-h4">{{ authStore.userExperience }}</div>
          <div class="text-caption">XP</div>
        </div>
        <div class="col-auto text-center">
          <div class="text-h4">{{ authStore.userStreak }}</div>
          <div class="text-caption">Streak</div>
        </div>
      </div>
    </q-card-section>

    <q-card-section v-if="!editMode">
      <div class="q-gutter-md">
        <!-- Profile Information -->
        <div class="row items-center">
          <div class="col-4 text-weight-medium">Username:</div>
          <div class="col">{{ authStore.user?.username || 'Not set' }}</div>
        </div>

        <div class="row items-center">
          <div class="col-4 text-weight-medium">Native Language:</div>
          <div class="col">{{ getNativeLanguageName(authStore.user?.native_language) }}</div>
        </div>

        <div class="row items-center">
          <div class="col-4 text-weight-medium">Member Since:</div>
          <div class="col">{{ formatDate(authStore.user?.created_at) }}</div>
        </div>

        <div class="row items-center">
          <div class="col-4 text-weight-medium">Last Activity:</div>
          <div class="col">{{ formatDate(authStore.user?.last_activity) || 'Never' }}</div>
        </div>

        <!-- Learning Preferences -->
        <q-separator class="q-my-md" />

        <div class="text-subtitle1 text-weight-medium q-mb-sm">Learning Preferences</div>

        <div class="row items-center">
          <div class="col-4 text-weight-medium">Daily Goal:</div>
          <div class="col">{{ preferences.dailyGoal || 'Not set' }} minutes</div>
        </div>

        <div class="row items-center">
          <div class="col-4 text-weight-medium">Difficulty:</div>
          <div class="col">{{ preferences.difficulty || 'Beginner' }}</div>
        </div>

        <div class="row items-center">
          <div class="col-4 text-weight-medium">Notifications:</div>
          <div class="col">
            <q-chip
              :color="preferences.notifications ? 'positive' : 'negative'"
              text-color="white"
              size="sm"
            >
              {{ preferences.notifications ? 'Enabled' : 'Disabled' }}
            </q-chip>
          </div>
        </div>
      </div>
    </q-card-section>

    <!-- Edit Mode -->
    <q-card-section v-else>
      <q-form @submit="handleSave" class="q-gutter-md">
        <q-input
          v-model="editForm.username"
          label="Username"
          outlined
          :rules="[(val) => !val || val.length >= 2 || 'Username must be at least 2 characters']"
        />

        <q-select
          v-model="editForm.native_language"
          :options="languageOptions"
          label="Native Language"
          outlined
          emit-value
          map-options
        />

        <q-input
          v-model.number="editForm.dailyGoal"
          label="Daily Goal (minutes)"
          type="number"
          outlined
          :rules="[
            (val) => !val || (val > 0 && val <= 480) || 'Goal must be between 1-480 minutes',
          ]"
        />

        <q-select
          v-model="editForm.difficulty"
          :options="difficultyOptions"
          label="Difficulty Level"
          outlined
        />

        <q-toggle v-model="editForm.notifications" label="Enable Notifications" color="primary" />

        <div class="row q-gutter-sm">
          <q-btn
            type="submit"
            label="Save Changes"
            color="primary"
            :loading="authStore.isLoading"
          />
          <q-btn
            label="Cancel"
            color="grey-6"
            outline
            @click="cancelEdit"
            :disable="authStore.isLoading"
          />
        </div>
      </q-form>
    </q-card-section>

    <q-card-actions v-if="!editMode" align="right">
      <q-btn flat label="Edit Profile" color="primary" @click="startEdit" />
      <q-btn flat label="Change Password" color="secondary" @click="showPasswordDialog = true" />
      <q-btn
        flat
        label="Sign Out"
        color="negative"
        @click="handleSignOut"
        :loading="signOutLoading"
      />
    </q-card-actions>

    <!-- Change Password Dialog -->
    <q-dialog v-model="showPasswordDialog">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">Change Password</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-form @submit="handlePasswordChange" class="q-gutter-md">
            <q-input
              v-model="passwordForm.newPassword"
              label="New Password"
              type="password"
              outlined
              :rules="[(val) => val.length >= 6 || 'Password must be at least 6 characters']"
            />

            <q-input
              v-model="passwordForm.confirmPassword"
              label="Confirm Password"
              type="password"
              outlined
              :rules="[(val) => val === passwordForm.newPassword || 'Passwords do not match']"
            />
          </q-form>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="grey-6" v-close-popup />
          <q-btn
            flat
            label="Update Password"
            color="primary"
            @click="handlePasswordChange"
            :loading="passwordLoading"
            :disable="
              !passwordForm.newPassword || passwordForm.newPassword !== passwordForm.confirmPassword
            "
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuthStore } from '../../stores/auth';

// Composables
const router = useRouter();
const $q = useQuasar();
const authStore = useAuthStore();

// State
const editMode = ref(false);
const showPasswordDialog = ref(false);
const signOutLoading = ref(false);
const passwordLoading = ref(false);

const editForm = reactive({
  username: '',
  native_language: 'en',
  dailyGoal: 30,
  difficulty: 'Beginner',
  notifications: true,
});

const passwordForm = reactive({
  newPassword: '',
  confirmPassword: '',
});

// Computed
const preferences = computed(() => {
  return (
    authStore.user?.preferences || {
      dailyGoal: 30,
      difficulty: 'Beginner',
      notifications: true,
    }
  );
});

// Options
const languageOptions = [
  { label: 'English', value: 'en' },
  { label: 'Spanish', value: 'es' },
  { label: 'French', value: 'fr' },
  { label: 'German', value: 'de' },
  { label: 'Chinese', value: 'zh' },
  { label: 'Korean', value: 'ko' },
];

const difficultyOptions = ['Beginner', 'Intermediate', 'Advanced'];

// Methods
const getNativeLanguageName = (code?: string): string => {
  const language = languageOptions.find((lang) => lang.value === code);
  return language?.label || 'English';
};

const formatDate = (dateString?: string): string => {
  if (!dateString) return '';

  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
};

const startEdit = () => {
  // Populate form with current values
  editForm.username = authStore.user?.username || '';
  editForm.native_language = authStore.user?.native_language || 'en';
  editForm.dailyGoal = preferences.value.dailyGoal || 30;
  editForm.difficulty = preferences.value.difficulty || 'Beginner';
  editForm.notifications = preferences.value.notifications !== false;

  editMode.value = true;
};

const cancelEdit = () => {
  editMode.value = false;
  authStore.setError(null);
};

const handleSave = async () => {
  const success = await authStore.updateProfile({
    username: editForm.username || undefined,
    native_language: editForm.native_language,
    preferences: {
      dailyGoal: editForm.dailyGoal,
      difficulty: editForm.difficulty,
      notifications: editForm.notifications,
    },
  });

  if (success) {
    $q.notify({
      type: 'positive',
      message: 'Profile updated successfully!',
    });
    editMode.value = false;
  } else if (authStore.error) {
    $q.notify({
      type: 'negative',
      message: authStore.error,
    });
  }
};

const handlePasswordChange = async () => {
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    return;
  }

  passwordLoading.value = true;

  try {
    const success = await authStore.updatePassword(passwordForm.newPassword);

    if (success) {
      $q.notify({
        type: 'positive',
        message: 'Password updated successfully!',
      });
      showPasswordDialog.value = false;
      passwordForm.newPassword = '';
      passwordForm.confirmPassword = '';
    } else if (authStore.error) {
      $q.notify({
        type: 'negative',
        message: authStore.error,
      });
    }
  } finally {
    passwordLoading.value = false;
  }
};

const handleSignOut = async () => {
  signOutLoading.value = true;

  try {
    const success = await authStore.signOut();

    if (success) {
      $q.notify({
        type: 'positive',
        message: 'Signed out successfully!',
      });
      void router.push('/auth/login');
    } else if (authStore.error) {
      $q.notify({
        type: 'negative',
        message: authStore.error,
      });
    }
  } finally {
    signOutLoading.value = false;
  }
};

onMounted(() => {
  // Initialize auth store if not already done
  if (!authStore.isInitialized) {
    void authStore.initialize();
  }
});
</script>

<style scoped>
.user-profile {
  max-width: 600px;
  margin: 0 auto;
}

@media (max-width: 480px) {
  .user-profile {
    margin: 0;
    box-shadow: none;
    border-radius: 0;
  }
}
</style>
