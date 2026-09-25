import { Platform } from 'react-native';

export const decorativeSvgProps = Platform.OS === 'web'
  ? { 'aria-hidden': true as const, focusable: false as const }
  : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };
