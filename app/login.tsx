// 파일: app/login.tsx
import { useRouter } from "expo-router";
import { useState } from "react";
import MeetDanLogo from "../components/Logo";
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

import { InputBox } from "../components/InputBox";
import { MainButton } from "@/components/MainButton";
import { API } from "@/api/client";
import { useStore } from "@/store/useStore";

import { Palette, Spacing } from "@/constants/theme";

export default function Login() {
  const router = useRouter();
  const setCurrentUser = useStore((state) => state.setCurrentUser);

  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    // 1. 유효성 검사
    if (!id) {
      Alert.alert("알림", "아이디를 입력해주세요.");
      return;
    }
    if (!password) {
      Alert.alert("알림", "비밀번호를 입력해주세요.");
      return;
    }

    try {
      setIsLoading(true);

      // 2. 아이디 → 이메일 해석 후 Supabase 로그인까지 API.login 이 처리한다.
      //    세션은 supabase-js 가 AsyncStorage 에 알아서 저장·갱신한다.
      const result = await API.login(id.trim(), password);

      if (result.code !== 200 || !result.data) {
        Alert.alert("로그인 실패", result.message || "다시 시도해주세요.");
        return;
      }

      // 3. 내 정보를 전역 상태에 올려둔다 (프로필·팀 생성 화면이 이 값을 쓴다)
      setCurrentUser(result.data);

      router.replace("/(tabs)");
    } catch (e) {
      console.error("❌ 로그인 에러:", e);
      Alert.alert("오류", "로그인 중 문제가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAwareScrollView
      style={styles.flex}
      contentContainerStyle={styles.container}
      enableOnAndroid
      extraScrollHeight={Platform.OS === "ios" ? 20 : 40}
      enableAutomaticScroll
      keyboardOpeningTime={0}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.formArea}>
        <View style={{ alignItems: "center", marginBottom: 30 }}>
          <MeetDanLogo size={150} showText={true} />
        </View>
        <Text style={styles.title}>로그인</Text>

        <InputBox
          label="아이디"
          placeholder=""
          value={id}
          onChangeText={setId}
        />

        <InputBox
          label="비밀번호"
          placeholder="비밀번호 입력"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={true}
        />

        <MainButton
          title={isLoading ? "로그인 중..." : "로그인"}
          onPress={handleLogin}
          isLoading={isLoading}
        />

        <TouchableOpacity
          onPress={() => router.push("/signupScreen")}
          style={{ marginTop: 20, alignSelf: "center" }}
        >
          <Text style={styles.signupLink}>회원가입</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Palette.white,
  },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.xxxl,
  },
  formArea: {
    width: "100%",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.8,
    color: Palette.gray900,
    marginBottom: 5,
  },
  signupLink: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.brand,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: -0.3,
    color: Palette.gray600,
    marginBottom: 40,
  },
});
