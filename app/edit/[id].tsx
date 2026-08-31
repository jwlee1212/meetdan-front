// 파일: app/edit/[id].tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

import { API } from "@/api/client";
import { Screen } from "@/components/ui/screen";
import { Palette, Radius, Spacing, Typo } from "@/constants/theme";
import { assertClean } from "@/utils/profanity";
import { useStore } from "../../store/useStore"; // ✅ 경로 확인

export default function EditTeam() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  // ✅ [수정] Zustand 훅에서 데이터와 함수 꺼내오기
  const { myTeams, updateTeam } = useStore();
  const [isSaving, setIsSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  // 평균 나이는 여기 없다. 팀원 출생연도로 서버가 계산한다(마이그레이션 006).
  // ✅ post/[id].tsx 상세 화면에 표시되는 캠퍼스·인원도 여기서 고칠 수 있어야 한다
  const [campus, setCampus] = useState<"죽전" | "천안">("죽전");
  const [count, setCount] = useState(3);
  const [currentCount, setCurrentCount] = useState(0);

  // 화면 열리면 데이터 채우기
  useEffect(() => {
    if (!id) return;

    // ✅ [수정] store에서 가져온 myTeams 사용
    const team = myTeams.find((t) => t.id === id);

    if (team) {
      setTitle(team.title);
      setContent(team.content || "");
      setCampus(team.campus);
      setCount(team.count);
      setCurrentCount(team.currentCount);
    } else {
      Alert.alert("오류", "팀 정보를 찾을 수 없습니다.", [
        { text: "확인", onPress: () => router.back() },
      ]);
    }
  }, [id, myTeams]); // myTeams가 로드되면 다시 실행

  const handleUpdate = async () => {
    if (!id) return;

    if (!title || !content) {
      Alert.alert("잠깐!", "내용을 모두 입력해주세요.");
      return;
    }

    if (!assertClean({ 제목: title, "우리 팀 어필": content })) return;

    // 이미 들어온 팀원 수보다 적게는 줄일 수 없다
    // (서버도 filled_count <= capacity 제약으로 한 번 더 막는다)
    if (count < currentCount) {
      Alert.alert(
        "잠깐!",
        `이미 ${currentCount}명이 모였어요. 인원을 그보다 적게 바꿀 수 없어요.`,
      );
      return;
    }

    setIsSaving(true);
    try {
      const result = await API.updateTeam(id, {
        title,
        content,
        campus,
        count,
      });

      if (result.code !== 200 || !result.data) {
        Alert.alert("오류", result.message ?? "팀 정보를 저장하지 못했어요.");
        return;
      }

      // 서버가 돌려준 값으로 맞춘다. 내 팀 탭이 다시 읽기 전까지의 표시용이다.
      updateTeam(id, result.data);

      Alert.alert("수정 완료! ✨", "팀 정보가 변경되었습니다.", [
        { text: "확인", onPress: () => router.back() },
      ]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.cancelText}>취소</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>팀 정보 수정</Text>
        <TouchableOpacity onPress={handleUpdate} disabled={isSaving} hitSlop={8}>
          {isSaving ? (
            <ActivityIndicator color={Palette.brand} />
          ) : (
            <Text style={styles.submitText}>완료</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.formContainer}
        enableOnAndroid
        extraScrollHeight={Platform.OS === "ios" ? 20 : 40}
        enableAutomaticScroll
        keyboardOpeningTime={0}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>캠퍼스</Text>
        <View style={styles.countContainer}>
          {(["죽전", "천안"] as const).map((c) => (
            <TouchableOpacity
              key={c}
              style={[
                styles.countButton,
                campus === c && styles.countButtonActive,
              ]}
              onPress={() => setCampus(c)}
            >
              <Text
                style={[
                  styles.countText,
                  campus === c && styles.countTextActive,
                ]}
              >
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>몇 명이서 나가나요?</Text>
        <View style={styles.countContainer}>
          {[2, 3, 4].map((num) => (
            <TouchableOpacity
              key={num}
              style={[
                styles.countButton,
                count === num && styles.countButtonActive,
              ]}
              onPress={() => setCount(num)}
              disabled={num < currentCount}
            >
              <Text
                style={[
                  styles.countText,
                  count === num && styles.countTextActive,
                  num < currentCount && styles.countTextDisabled,
                ]}
              >
                {num}:{num}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {currentCount > 0 && (
          <Text style={styles.hint}>
            현재 {currentCount}명이 모여 있어서 그보다 적은 인원은 고를 수
            없어요.
          </Text>
        )}

        <Text style={styles.label}>제목 (학과 + 인원)</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="예: 소프트웨어학과 3명"
        />

        <Text style={styles.label}>우리 팀 어필 (MBTI, 주량 등)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={content}
          onChangeText={setContent}
          multiline={true}
          placeholder="MBTI랑 좋아하는 술 스타일 적어주세요!"
        />
        <Text style={styles.hint}>
          * 여기서 내용을 수정하면 상세 페이지에 바로 반영됩니다.
        </Text>
      </KeyboardAwareScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.screen,
  },
  headerTitle: { ...Typo.title, fontSize: 17 },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.3,
    color: Palette.gray600,
  },
  submitText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.brand,
  },

  formContainer: {
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.xs,
    paddingBottom: 100,
  },
  label: {
    ...Typo.section,
    marginBottom: Spacing.sm,
    marginTop: Spacing.xl,
  },
  // 흰 화면 위에서는 테두리보다 회색으로 채우는 편이 입력칸임을 더 잘 알린다.
  input: {
    backgroundColor: Palette.gray100,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: -0.3,
    color: Palette.gray900,
  },
  textArea: {
    height: 140,
    paddingTop: 13,
    textAlignVertical: "top",
    marginTop: 0,
  },
  hint: {
    ...Typo.caption,
    marginTop: Spacing.md,
    lineHeight: 18,
  },
  countContainer: { flexDirection: "row", gap: Spacing.sm },
  countButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray100,
    alignItems: "center",
  },
  countButtonActive: {
    backgroundColor: Palette.brand,
    borderColor: Palette.brand,
  },
  countText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray600,
  },
  countTextActive: { color: Palette.white },
  countTextDisabled: { color: Palette.gray400 },
});
