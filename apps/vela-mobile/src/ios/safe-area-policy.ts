export type SafeAreaPolicy = {
  contentInset: 'always' | 'never';
  headerlessTopOwner: 'native-scroll-view' | 'css';
};

export const safeAreaPolicy: SafeAreaPolicy = {
  contentInset: 'never',
  headerlessTopOwner: 'css',
};
