import { useLocalSearchParams, useNavigation } from 'expo-router'
import {
  useMobileTaskHostNavigation,
  type MobileTasksHostNavigation
} from './use-mobile-task-host-navigation'

export function useMobileTaskHostRouteNavigation(): void {
  const { hostId } = useLocalSearchParams<{ hostId?: string }>()
  const navigation = useNavigation<MobileTasksHostNavigation>()
  useMobileTaskHostNavigation(navigation, hostId)
}
