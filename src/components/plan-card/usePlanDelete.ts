import { useState } from 'react';
import { Alert } from 'react-native';
import { mockPlans } from '../../../mock-data/mockPlans';

export function usePlanDelete() {
  const [plans, setPlans] = useState([...mockPlans]);
  const [editMode, setEditMode] = useState(false);

  function toggleEditMode() {
    setEditMode((prev) => !prev);
  }

  function requestDelete(id: string) {
    const plan = plans.find((p) => p.id === id);
    if (!plan) return;

    Alert.alert(
      'Delete Plan',
      `Are you sure you want to delete "${plan.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const idx = mockPlans.findIndex((p) => p.id === id);
            if (idx !== -1) mockPlans.splice(idx, 1);
            setPlans((prev) => prev.filter((p) => p.id !== id));
          },
        },
      ],
    );
  }

  return { plans, editMode, toggleEditMode, requestDelete };
}
