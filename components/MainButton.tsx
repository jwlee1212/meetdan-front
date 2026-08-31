import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableOpacityProps,
} from "react-native";
import { Colors, Palette } from "@/constants/theme";

interface MainButtonProps extends TouchableOpacityProps {
  title: string;
  isLoading?: boolean;
}

export const MainButton = ({
  title,
  isLoading = false,
  disabled = false,
  style,
  ...props
}: MainButtonProps) => {
  const isDisabled = disabled || isLoading;

  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled, style]}
      disabled={isDisabled}
      activeOpacity={0.85}
      {...props}
    >
      {isLoading ? (
        <ActivityIndicator color={Palette.white} />
      ) : (
        <Text
          style={[styles.buttonText, disabled && styles.buttonTextDisabled]}
        >
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.light.primary, // 테마에서 색상 가져옴
    paddingVertical: 17,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    backgroundColor: Colors.light.backgroundMuted,
  },
  buttonText: {
    color: Palette.white,
    fontSize: 17,
    fontWeight: "700",
  },
  buttonTextDisabled: {
    color: Colors.light.disabled,
  },
});
