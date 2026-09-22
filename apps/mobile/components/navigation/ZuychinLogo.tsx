import { SvgXml } from 'react-native-svg';
import type { StyleProp, ViewStyle } from 'react-native';
import { ARCADE_LOGO_ASPECT, ARCADE_LOGO_SVG } from '../../constants/arcadeLogo';

type Props = {
  color?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

export default function ZuychinLogo({ color = '#FF2E88', height = 18, style }: Props) {
  return (
    <SvgXml
      xml={ARCADE_LOGO_SVG.replace(/currentColor/g, color)}
      width={Math.round(height * ARCADE_LOGO_ASPECT)}
      height={height}
      style={style}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
