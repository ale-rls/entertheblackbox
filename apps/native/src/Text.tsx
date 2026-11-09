import React from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';
import { useOptikLoaded } from './fonts';
import { optikFace } from './typography';

// Drop-in Text/TextInput that render in Optik once it has loaded.
export function Text(props: TextProps) {
  const optik = useOptikLoaded();
  if (!optik) return <RNText {...props} />;
  const flat = StyleSheet.flatten(props.style) ?? {};
  return <RNText {...props} style={[props.style, optikFace(flat)]} />;
}

export const TextInput = React.forwardRef<RNTextInput, TextInputProps>(function TextInput(props, ref) {
  const optik = useOptikLoaded();
  if (!optik) return <RNTextInput ref={ref} {...props} />;
  const flat = StyleSheet.flatten(props.style) ?? {};
  return <RNTextInput ref={ref} {...props} style={[props.style, optikFace(flat)]} />;
});
