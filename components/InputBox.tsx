import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  TextInputProps,
} from "react-native";
import { Colors, Palette } from "@/constants/theme";

interface InputBoxProps extends TextInputProps {
  label: string;
  error?: string;
}

export const InputBox = ({
  label,
  style,
  error,
  onFocus,
  onBlur,
  ...props
}: InputBoxProps) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.inputContainer}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          isFocused && styles.inputFocused,
          !!error && styles.inputError,
          style,
        ]}
        autoCapitalize="none"
        placeholderTextColor={Palette.gray400}
        onFocus={(e) => {
          setIsFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          onBlur?.(e);
        }}
        {...props}
      />
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: Colors.light.textSecondary,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderColor: Palette.gray200,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 14,
    fontSize: 16,
    color: Colors.light.text,
    backgroundColor: Colors.light.backgroundMuted,
  },
  inputFocused: {
    borderColor: Colors.light.primary,
    backgroundColor: Palette.white,
  },
  inputError: {
    borderColor: Palette.red,
  },
  errorText: {
    marginTop: 6,
    fontSize: 13,
    color: Palette.red,
    fontWeight: "500",
  },
});
