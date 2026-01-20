import { useCallback } from 'react';
import type { WorktreeInfo, FeatureInfo } from '../types';

interface UseRunningFeaturesOptions {
  runningFeatureIds: string[];
  features: FeatureInfo[];
}

export function useRunningFeatures({ runningFeatureIds, features }: UseRunningFeaturesOptions) {
  const hasRunningFeatures = useCallback(
    (worktree: WorktreeInfo) => {
      if (runningFeatureIds.length === 0) return false;

      return runningFeatureIds.some((featureId) => {
        const feature = features.find((f) => f.id === featureId);
        if (!feature) return false;

        // Match by branchName only (worktreePath is no longer stored)
        if (feature.branchName) {
          // Special case: if feature is on 'main' branch, it belongs to main worktree
          // irrespective of whether the branch name matches exactly (it should, but strict equality might fail if refs differ)
          if (worktree.isMain && feature.branchName === 'main') {
            return true;
          }
          return worktree.branch === feature.branchName;
        }

        // No branch assigned - belongs to main worktree
        return worktree.isMain;
      });
    },
    [runningFeatureIds, features]
  );

  return {
    hasRunningFeatures,
  };
}
