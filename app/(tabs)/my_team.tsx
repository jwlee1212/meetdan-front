// 파일: app/(tabs)/my_team.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API } from "@/api/client";

import { Badge, BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PressScale } from "@/components/ui/press-scale";
import { Screen, ScreenHeader } from "@/components/ui/screen";
import {
  Colors,
  Hairline,
  Palette,
  Radius,
  Shadow,
  Spacing,
  Typo,
} from "@/constants/theme";
import { useStore, Team } from "../../store/useStore";

/** 팀 상태를 뱃지 문구/색으로 한 번에 정리 */
function teamStatus(team: Team): { label: string; tone: BadgeTone } {
  // 매칭이 성사된 팀은 게시판에서 내려가고 더 이상 신청을 주고받지 않는다.
  if (team.status === "MATCHED") return { label: "매칭 완료", tone: "brand" };
  if (team.status === "ACTIVE") return { label: "공개중", tone: "solid" };
  if (team.currentCount >= team.count)
    return { label: "준비완료", tone: "success" };
  return { label: "모집중", tone: "neutral" };
}

export default function MyTeamTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const myTeams = useStore((state) => state.myTeams);
  const setMyTeams = useStore((state) => state.setMyTeams);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [inputCode, setInputCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 시트 하단 여백을 키보드 상태에 맞춰 조정하려면 열림/닫힘을 알아야 한다.
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setIsKeyboardOpen(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setIsKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // 화면을 벗어난 뒤 타이머가 살아 있으면 언마운트된 컴포넌트를 건드린다.
  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const handleCopyCode = async (team: Team) => {
    if (!team.inviteCode) return;

    await Clipboard.setStringAsync(team.inviteCode);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // "복사됨" 표시는 잠깐만 띄운다. 다른 팀 코드를 연달아 복사할 수 있으니
    // 이전 타이머는 반드시 지운다.
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    setCopiedId(team.id);
    copiedTimer.current = setTimeout(() => setCopiedId(null), 1500);
  };

  /**
   * 서버가 팀의 유일한 출처다. 인원 수·상태·초대 코드는 전부 트리거가 만들기
   * 때문에, 화면에서 미리 계산해두면 서버 값과 어긋난다. 쓰기 뒤에는 항상 다시 읽는다.
   */
  const reload = useCallback(async () => {
    const result = await API.getMyTeams();
    if (result.code !== 200 || !result.data) {
      // 401(세션 만료)은 _layout.tsx 가 로그인 화면으로 보내므로 조용히 둔다.
      if (result.code !== 401) {
        Alert.alert("오류", result.message ?? "팀 목록을 불러오지 못했어요.");
      }
      return;
    }
    setMyTeams(result.data);
  }, [setMyTeams]);

  // 팀을 만들고 돌아오거나, 다른 기기에서 팀원이 들어온 뒤 돌아올 수도 있다.
  // 탭에 들어올 때마다 다시 읽는다.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await reload();
        if (alive) setIsLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [reload]),
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await reload();
    setIsRefreshing(false);
  };

  const handleDelete = (team: Team) => {
    // 팀장만 팀을 지울 수 있다(teams_delete 정책). 팀원은 자기 자리만 뺀다.
    const isOwner = team.isOwner ?? false;

    Alert.alert(
      isOwner ? "팀을 삭제할까요?" : "팀에서 나갈까요?",
      isOwner
        ? "삭제하면 되돌릴 수 없어요. 팀원들도 함께 빠져나가요."
        : "다시 들어오려면 초대 코드가 필요해요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: isOwner ? "삭제" : "나가기",
          style: "destructive",
          onPress: async () => {
            const result = isOwner
              ? await API.deleteTeam(team.id)
              : await API.leaveTeam(team.id);
            if (result.code !== 200) {
              Alert.alert("오류", result.message ?? "처리하지 못했어요.");
              return;
            }
            await reload();
          },
        },
      ],
    );
  };

  const handleTogglePublic = async (team: Team, isPublic: boolean) => {
    const result = await API.setTeamPublic(team.id, isPublic);
    if (result.code !== 200) {
      Alert.alert("오류", result.message ?? "상태를 바꾸지 못했어요.");
      return;
    }
    await reload();
  };

  const handleJoinTeam = async () => {
    const code = inputCode.trim();
    if (!code) {
      Alert.alert("초대 코드를 입력해주세요");
      return;
    }

    setIsJoining(true);
    try {
      // 코드가 틀렸는지, 정원이 찼는지, 이미 들어간 팀인지는 서버가 구분해서 알려준다.
      const result = await API.joinTeamByCode(code);
      if (result.code !== 200 || !result.data) {
        Alert.alert("참가할 수 없어요", result.message ?? "다시 시도해주세요.");
        return;
      }

      setJoinModalVisible(false);
      setInputCode("");
      await reload();
      Alert.alert("참가 완료", `${result.data.title} 팀에 합류했어요.`);
    } finally {
      setIsJoining(false);
    }
  };

  const renderTeamCard = ({ item }: { item: Team }) => {
    const isFull = item.currentCount >= item.count;
    const isPublic = item.status === "ACTIVE";
    const isMatched = item.status === "MATCHED";
    const isOwner = item.isOwner ?? false;
    const isExpanded = expandedId === item.id;
    const isCopied = copiedId === item.id;
    const status = teamStatus(item);
    const progress = Math.min(item.currentCount / item.count, 1);

    return (
      <PressScale
        scaleTo={0.985}
        style={styles.card}
        onPress={() => setExpandedId(isExpanded ? null : item.id)}
      >
        <View style={styles.cardTop}>
          <Badge label={status.label} tone={status.tone} />
          <Ionicons
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={Palette.gray400}
          />
        </View>

        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.cardMeta}>
          {item.campus} · {item.dept}
          {item.age != null && ` · 평균 ${item.age}세`}
        </Text>

        {/* 인원 현황을 막대로 보여주면 "몇 명 더 모아야 하는지"가 즉시 읽힌다 */}
        <View style={styles.progressBlock}>
          <View style={styles.progressLabelRow}>
            <Text style={styles.progressLabel}>
              {isFull
                ? "인원이 다 모였어요"
                : `${item.count - item.currentCount}명만 더 모으면 돼요`}
            </Text>
            <Text style={styles.progressCount}>
              {item.currentCount}
              <Text style={styles.progressTotal}>/{item.count}</Text>
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progress * 100}%`,
                  backgroundColor: isFull ? Palette.green : Palette.brand,
                },
              ]}
            />
          </View>
        </View>

        {isExpanded && (
          <View style={styles.detail}>
            {/* 코드가 있을 때만 누를 수 있다. "없음"을 복사해봐야 쓸모가 없다. */}
            <Pressable
              onPress={() => handleCopyCode(item)}
              disabled={!item.inviteCode}
              style={({ pressed }) => [
                styles.codeBox,
                pressed && item.inviteCode && { opacity: 0.7 },
              ]}
            >
              <View>
                <Text style={styles.codeLabel}>
                  {isCopied ? "코드를 복사했어요" : "초대 코드"}
                </Text>
                <Text style={styles.codeValue}>
                  {item.inviteCode || "없음"}
                </Text>
              </View>
              {item.inviteCode ? (
                <View style={styles.copyBtn}>
                  <Ionicons
                    name={isCopied ? "checkmark" : "copy-outline"}
                    size={16}
                    color={isCopied ? Palette.green : Palette.gray600}
                  />
                  <Text
                    style={[
                      styles.copyText,
                      isCopied && { color: Palette.green },
                    ]}
                  >
                    {isCopied ? "복사됨" : "복사"}
                  </Text>
                </View>
              ) : (
                <Ionicons
                  name="ticket-outline"
                  size={22}
                  color={Palette.gray400}
                />
              )}
            </Pressable>

            {/*
              매칭이 끝난 팀은 상태가 잠긴다. 서버도 MATCHED 팀의 상태 변경을
              거부한다(마이그레이션 009). 여기서 버튼을 감추는 건, 눌러도
              오류만 나는 길을 보여주지 않으려는 것이다.
            */}
            {isMatched && (
              <View style={styles.lockedBox}>
                <Ionicons name="heart" size={15} color={Palette.brand} />
                <Text style={[styles.lockedText, { color: Palette.brandText }]}>
                  매칭이 성사된 팀이에요. 활동 탭에서 대화를 이어가세요
                </Text>
              </View>
            )}

            {/* 공개 전환은 팀장 몫이다. teams_update 정책도 팀장만 통과시킨다. */}
            {isOwner && isFull && !isMatched && (
              <Pressable
                onPress={() => handleTogglePublic(item, !isPublic)}
                style={({ pressed }) => [
                  styles.primaryAction,
                  isPublic && styles.secondaryAction,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    styles.primaryActionText,
                    isPublic && styles.secondaryActionText,
                  ]}
                >
                  {isPublic ? "비공개로 돌리기" : "게시판에 등록하기"}
                </Text>
              </Pressable>
            )}

            {isOwner && !isFull && !isMatched && (
              <View style={styles.lockedBox}>
                <Ionicons
                  name="lock-closed"
                  size={15}
                  color={Palette.gray500}
                />
                <Text style={styles.lockedText}>
                  팀원이 다 모여야 공개할 수 있어요
                </Text>
              </View>
            )}

            {!isOwner && !isMatched && (
              <View style={styles.lockedBox}>
                <Ionicons name="people" size={15} color={Palette.gray500} />
                <Text style={styles.lockedText}>
                  팀장이 게시판 공개를 결정해요
                </Text>
              </View>
            )}

            <View style={styles.manageRow}>
              {isOwner && (
                <>
                  <Pressable
                    style={styles.manageBtn}
                    onPress={() => router.push(`/edit/${item.id}` as any)}
                  >
                    <Ionicons
                      name="create-outline"
                      size={17}
                      color={Palette.gray600}
                    />
                    <Text style={styles.manageText}>정보 수정</Text>
                  </Pressable>

                  <View style={styles.manageDivider} />
                </>
              )}

              <Pressable
                style={styles.manageBtn}
                onPress={() => handleDelete(item)}
              >
                <Ionicons
                  name={isOwner ? "trash-outline" : "exit-outline"}
                  size={17}
                  color={Palette.red}
                />
                <Text style={[styles.manageText, { color: Palette.red }]}>
                  {isOwner ? "팀 삭제" : "팀 나가기"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </PressScale>
    );
  };

  return (
    <Screen>
      <ScreenHeader title="내 팀" subtitle="만든 팀과 참여한 팀을 관리해요" />

      <View style={styles.actionRow}>
        <PressScale
          scaleTo={0.96}
          style={[styles.actionCard, styles.actionCardBrand]}
          onPress={() => router.push("/write")}
        >
          <Ionicons name="add-circle" size={22} color={Palette.brand} />
          <Text style={[styles.actionText, { color: Palette.brandText }]}>
            팀 만들기
          </Text>
        </PressScale>

        <PressScale
          scaleTo={0.96}
          style={styles.actionCard}
          onPress={() => setJoinModalVisible(true)}
        >
          <Ionicons name="ticket" size={22} color={Palette.gray600} />
          <Text style={styles.actionText}>코드로 참여</Text>
        </PressScale>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Palette.brand} />
        </View>
      ) : (
        <FlatList
          data={myTeams}
          renderItem={renderTeamCard}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={Palette.brand}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title="아직 만든 팀이 없어요"
              description="팀을 만들고 초대 코드로 친구를 부르면 과팅을 시작할 수 있어요."
              actionLabel="첫 팀 만들기"
              onAction={() => router.push("/write")}
            />
          }
        />
      )}

      {/* 초대 코드 입력: 아래에서 올라오는 시트 */}
      <Modal
        visible={joinModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setJoinModalVisible(false)}
      >
        {/*
          시트가 화면 맨 아래에 붙어 있어서 키보드가 올라오면 입력창과 버튼이 그대로 가린다.
          iOS는 padding으로 시트를 밀어 올리고, Android는 edge-to-edge라 창이 리사이즈되지
          않으므로 키보드 이벤트로 높이를 계산하는 height 방식을 쓴다.
        */}
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setJoinModalVisible(false)}
          />
          <View
            style={[
              styles.sheet,
              // 키보드가 떠 있으면 홈 인디케이터 영역은 가려지므로 그만큼 여백을 뺀다.
              { paddingBottom: isKeyboardOpen ? 20 : insets.bottom + 20 },
            ]}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>초대 코드 입력</Text>
            <Text style={styles.sheetDesc}>
              친구에게 받은 6자리 코드를 입력해주세요.{"\n"}
              과팅 팀이라 같은 성별끼리만 모일 수 있어요.
            </Text>

            <TextInput
              style={styles.codeInput}
              placeholder="X7A9Z2"
              placeholderTextColor={Palette.gray400}
              value={inputCode}
              onChangeText={(t) => setInputCode(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              returnKeyType="go"
              onSubmitEditing={handleJoinTeam}
            />

            <Pressable
              onPress={handleJoinTeam}
              disabled={!inputCode.trim() || isJoining}
              style={({ pressed }) => [
                styles.sheetSubmit,
                (!inputCode.trim() || isJoining) && styles.sheetSubmitDisabled,
                pressed && { opacity: 0.85 },
              ]}
            >
              {isJoining ? (
                <ActivityIndicator color={Palette.gray500} />
              ) : (
                <Text
                  style={[
                    styles.sheetSubmitText,
                    !inputCode.trim() && { color: Palette.gray400 },
                  ]}
                >
                  입장하기
                </Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },

  actionRow: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.screen,
    paddingBottom: Spacing.xl,
  },
  actionCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray100,
  },
  actionCardBrand: { backgroundColor: Palette.brandWeak },
  actionText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },

  listContent: { paddingHorizontal: Spacing.screen, paddingBottom: Spacing.xxxl },

  card: {
    backgroundColor: Palette.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: Spacing.xl,
    marginBottom: Spacing.md,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  cardTitle: Typo.subtitle,
  cardMeta: { ...Typo.caption, marginTop: 4 },

  progressBlock: { marginTop: Spacing.lg },
  progressLabelRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: Palette.gray600,
  },
  progressCount: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray900,
  },
  progressTotal: { color: Palette.gray400, fontSize: 13 },
  progressTrack: {
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray100,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: Radius.full },

  detail: {
    marginTop: Spacing.xl,
    paddingTop: Spacing.xl,
    borderTopWidth: Hairline.height,
    borderTopColor: Hairline.color,
    gap: Spacing.md,
  },
  codeBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Palette.gray50,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  codeLabel: { ...Typo.caption, fontSize: 12 },
  codeValue: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 2,
    color: Palette.gray900,
    marginTop: 2,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Palette.white,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  copyText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: Palette.gray600,
  },

  primaryAction: {
    paddingVertical: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Palette.brand,
    alignItems: "center",
  },
  primaryActionText: {
    color: Palette.white,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  secondaryAction: { backgroundColor: Palette.gray100 },
  secondaryActionText: { color: Palette.gray700 },

  lockedBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray50,
  },
  lockedText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: Palette.gray500,
  },

  manageRow: { flexDirection: "row", alignItems: "center" },
  manageBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: Spacing.sm,
  },
  manageText: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: Palette.gray600,
  },
  manageDivider: { width: 1, height: 14, backgroundColor: Palette.gray200 },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(25,31,40,0.45)" },
  sheet: {
    backgroundColor: Palette.white,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.md,
    ...Shadow.modal,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray200,
    marginBottom: Spacing.xl,
  },
  sheetTitle: Typo.title,
  sheetDesc: { ...Typo.caption, marginTop: 6, marginBottom: Spacing.xl },
  codeInput: {
    backgroundColor: Palette.gray100,
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 6,
    color: Palette.gray900,
    marginBottom: Spacing.md,
  },
  sheetSubmit: {
    paddingVertical: 17,
    borderRadius: Radius.md,
    backgroundColor: Palette.brand,
    alignItems: "center",
  },
  sheetSubmitDisabled: { backgroundColor: Palette.gray100 },
  sheetSubmitText: {
    color: Palette.white,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
});
