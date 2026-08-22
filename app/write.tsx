// 파일: app/write.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  Platform,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";

import { API } from "@/api/client";
import { useStore } from "../store/useStore";

// post/[id].tsx 상세 화면이 태그를 그대로 보여주므로, 여기서 적은 값이 곧 표시될 내용이다.
// 서버 제약(teams_tags_bounded, 마이그레이션 006)과 같은 숫자여야 한다.
const MAX_TAGS = 3;
const MAX_TAG_LENGTH = 12; // '#' 제외

/**
 * 사람이 적은 한 줄을 태그 하나로 다듬는다.
 * "  술찌 " → "#술찌", "##술찌" → "#술찌", 공백은 중간에서도 지운다.
 * (태그는 한 덩어리로 읽히는 말이라 띄어쓰기가 들어가면 보기 흉하다.)
 */
const normalizeTag = (raw: string): string => {
  const body = raw
    .replace(/\s+/g, "")
    .replace(/^#+/, "")
    .slice(0, MAX_TAG_LENGTH);
  return body ? `#${body}` : "";
};

export default function Write() {
  const router = useRouter();
  const currentUser = useStore((state) => state.currentUser);

  // ✅ [추가] 캠퍼스 선택 상태 (기본값: 죽전)
  const [campus, setCampus] = useState<"죽전" | "천안">("죽전");

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [count, setCount] = useState(3);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addTag = () => {
    // "술찌, 맛집탐방" 처럼 쉼표로 여러 개를 한 번에 적는 사람이 있다
    const incoming = tagDraft.split(",").map(normalizeTag).filter(Boolean);
    if (incoming.length === 0) return;

    const next = [...tags];
    let dropped = false;
    for (const tag of incoming) {
      if (next.includes(tag) || next.length >= MAX_TAGS) {
        dropped = true;
        continue;
      }
      next.push(tag);
    }

    setTags(next);
    setTagDraft("");

    // 하나도 못 들어갔을 때만 알린다. 두 개 중 하나가 들어간 경우는
    // 아래 칩 목록을 보면 무엇이 빠졌는지 바로 보인다.
    if (dropped && next.length === tags.length) {
      Alert.alert(
        "알림",
        tags.length >= MAX_TAGS
          ? `태그는 최대 ${MAX_TAGS}개까지 넣을 수 있어요.`
          : "이미 추가한 태그예요.",
      );
    }
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleSubmit = async () => {
    if (!title || !content) {
      Alert.alert("잠깐!", "제목과 내용을 모두 입력해주세요.");
      return;
    }
    if (tags.length === 0) {
      Alert.alert("잠깐!", "우리 팀을 표현할 태그를 1개 이상 적어주세요.");
      return;
    }

    // 팀의 학과·성별은 서버가 내 프로필에서 채우므로, 로그인 상태만 확인한다
    if (!currentUser) {
      Alert.alert(
        "알림",
        "내 정보를 불러오지 못했어요. 다시 로그인한 뒤 시도해주세요.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      // 팀장 등록(team_members)·초대 코드·인원 현황·평균 나이는 전부 서버
      // 트리거가 만든다. 여기서는 사람이 입력한 값만 보낸다.
      const result = await API.createTeam({
        title,
        content,
        campus,
        count,
        tags,
      });

      if (result.code !== 200 || !result.data) {
        Alert.alert("오류", result.message ?? "방 생성에 실패했어요.");
        return;
      }

      Alert.alert(
        "방 생성 완료! 🏠",
        `초대 코드는 ${result.data.inviteCode ?? "내 팀 탭"}이에요. 친구에게 알려주세요.`,
        [
          {
            text: "확인",
            onPress: () => router.replace("/(tabs)/my_team"),
          },
        ],
      );
    } catch (error) {
      Alert.alert("오류", "방 생성 중 문제가 발생했습니다.");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.cancelText}>취소</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>팀 만들기</Text>
        <TouchableOpacity onPress={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? (
            <ActivityIndicator color="#3288FF" />
          ) : (
            <Text style={styles.submitText}>완료</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={[styles.formContainer, { paddingBottom: 100 }]}
        enableOnAndroid
        extraScrollHeight={Platform.OS === "ios" ? 20 : 40}
        enableAutomaticScroll
        keyboardOpeningTime={0}
        keyboardShouldPersistTaps="handled"
      >
        {/* ✅ [추가] 캠퍼스 선택 UI */}
        <Text style={styles.label}>캠퍼스는 어디인가요?</Text>
        <View style={styles.countContainer}>
          {["죽전", "천안"].map((c) => (
            <TouchableOpacity
              key={c}
              style={[
                styles.countButton,
                campus === c && styles.countButtonActive,
              ]}
              onPress={() => setCampus(c as "죽전" | "천안")}
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
            >
              <Text
                style={[
                  styles.countText,
                  count === num && styles.countTextActive,
                ]}
              >
                {num}:{num}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 평균 나이는 입력칸이 아니다. 팀원이 가입 때 적은 출생연도로
            서버가 계산해서 채운다(마이그레이션 006). 여기서는 지금 값이
            어떻게 잡혀 있는지만 보여준다. */}
        <Text style={styles.label}>평균 나이</Text>
        <View style={styles.infoBox}>
          <Ionicons name="calculator-outline" size={18} color="#3288FF" />
          <View style={styles.infoTextBox}>
            <Text style={styles.infoValue}>
              {currentUser?.age != null
                ? `지금은 ${currentUser.age}세 (나 혼자)`
                : "아직 계산할 수 없어요"}
            </Text>
            <Text style={styles.infoHint}>
              {currentUser?.age != null
                ? "팀원이 들어올 때마다 각자 나이로 다시 계산돼요."
                : "가입할 때 출생연도를 등록한 팀원부터 평균에 반영돼요."}
            </Text>
          </View>
        </View>

        <Text style={styles.label}>제목 (임팩트 있게!)</Text>
        <TextInput
          style={styles.input}
          placeholder="소프트웨어학과 3명 술 진탕 마셔요"
          placeholderTextColor="#999"
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.label}>
          우리 팀 태그 ({tags.length}/{MAX_TAGS})
        </Text>
        <View style={styles.tagInputRow}>
          <TextInput
            style={[styles.input, styles.tagInput]}
            placeholder="예: 술찌, 맛집탐방"
            placeholderTextColor="#999"
            value={tagDraft}
            onChangeText={setTagDraft}
            onSubmitEditing={addTag}
            // 태그를 연달아 적는 흐름이라 키보드를 내리지 않는다
            blurOnSubmit={false}
            returnKeyType="done"
            // 쉼표로 3개를 한 번에 적을 수 있어야 하므로 넉넉히 잡는다.
            // 태그 하나의 길이는 normalizeTag 가 자른다.
            maxLength={(MAX_TAG_LENGTH + 2) * MAX_TAGS}
            editable={tags.length < MAX_TAGS}
          />
          <TouchableOpacity
            style={[
              styles.tagAddButton,
              (!tagDraft.trim() || tags.length >= MAX_TAGS) &&
                styles.tagAddButtonDisabled,
            ]}
            onPress={addTag}
            disabled={!tagDraft.trim() || tags.length >= MAX_TAGS}
          >
            <Text style={styles.tagAddButtonText}>추가</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          {tags.length >= MAX_TAGS
            ? `태그는 ${MAX_TAGS}개까지예요. 바꾸려면 하나를 지워주세요.`
            : `#은 자동으로 붙어요. 쉼표로 여러 개, 한 개당 ${MAX_TAG_LENGTH}자까지.`}
        </Text>

        {tags.length > 0 && (
          <View style={styles.tagGrid}>
            {tags.map((tag) => (
              <TouchableOpacity
                key={tag}
                style={styles.tagChip}
                onPress={() => removeTag(tag)}
              >
                <Text style={styles.tagChipText}>{tag}</Text>
                <Ionicons name="close" size={14} color="#3288FF" />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.label}>우리 팀 매력 어필</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="MBTI, 주량, 분위기 등 자유롭게 적어주세요."
          placeholderTextColor="#999"
          multiline={true}
          value={content}
          onChangeText={setContent}
          textAlignVertical="top"
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 60,
    paddingBottom: 15,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fff",
  },
  headerTitle: { fontSize: 18, fontWeight: "bold" },
  cancelText: { fontSize: 16, color: "#666" },
  submitText: { fontSize: 16, fontWeight: "bold", color: "#3288FF" },
  formContainer: { padding: 20 },
  label: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
    marginTop: 20,
    color: "#333",
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingVertical: 10,
    fontSize: 16,
    color: "#000",
  },
  textArea: {
    height: 150,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 10,
    marginTop: 5,
    borderBottomWidth: 1,
  },
  countContainer: { flexDirection: "row", gap: 10 },
  countButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  countButtonActive: { backgroundColor: "#E8F3FF", borderColor: "#3288FF" },
  countText: { fontSize: 16, color: "#888", fontWeight: "bold" },
  countTextActive: { color: "#3288FF" },
  hint: { marginTop: 8, color: "#888", fontSize: 12 },

  // 평균 나이 안내 — 입력칸이 아니라 '서버가 계산한다'는 표시다
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#F4F8FF",
  },
  infoTextBox: { flex: 1 },
  infoValue: { fontSize: 15, fontWeight: "bold", color: "#333" },
  infoHint: { marginTop: 4, fontSize: 12, color: "#888", lineHeight: 17 },

  tagInputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  tagInput: { flex: 1 },
  tagAddButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#E8F3FF",
  },
  tagAddButtonDisabled: { backgroundColor: "#f5f5f5" },
  tagAddButtonText: { fontSize: 14, fontWeight: "bold", color: "#3288FF" },

  tagGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: "#E8F3FF",
    borderWidth: 1,
    borderColor: "#3288FF",
  },
  tagChipText: { fontSize: 14, color: "#3288FF", fontWeight: "600" },
});
