// 파일: app/(tabs)/history.tsx
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { API } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PressScale } from "@/components/ui/press-scale";
import { Divider, Screen, ScreenHeader } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { Palette, Radius, Spacing, Typo } from "@/constants/theme";
import { dDayLabel, formatPlanSummary, isPastPlan } from "@/utils/plan";
import { Match, MatchRequest, useStore } from "../../store/useStore";

type TabType = "RECEIVED" | "SENT" | "MATCHES";

/** 신청 상태별로 보여줄 뱃지와 안내 문구 */
const requestStatusView = (row: MatchRequest) => {
  if (row.status === "ACCEPTED") {
    return {
      label: "수락함",
      tone: "success" as const,
      hint: "매칭 탭에서 대화를 이어가세요",
    };
  }
  if (row.status === "REJECTED") {
    return {
      label: "거절함",
      tone: "neutral" as const,
      hint: "거절한 신청이에요",
    };
  }
  return row.received
    ? {
        label: "신청 도착",
        tone: "brand" as const,
        hint: "확인하고 수락해보세요",
      }
    : {
        label: "수락 대기중",
        tone: "neutral" as const,
        hint: "성사되면 알림을 보내드릴게요",
      };
};

export default function HistoryTab() {
  const router = useRouter();
  const receivedList = useStore((state) => state.receivedRequests);
  const sentList = useStore((state) => state.sentRequests);
  const matches = useStore((state) => state.matches);
  const setRequests = useStore((state) => state.setRequests);
  const setMatches = useStore((state) => state.setMatches);

  const [activeTab, setActiveTab] = useState<TabType>("RECEIVED");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * 신청도 매칭도 서버가 유일한 출처다.
   *
   * 상대가 방금 수락했을 수도, 내 신청이 자동 거절됐을 수도 있다
   * (상대 팀이 다른 팀과 매칭되면 트리거가 남은 신청을 전부 거절한다).
   * 화면에서 상태를 짐작하지 않고 탭에 들어올 때마다 다시 읽는다.
   */
  const reload = useCallback(async () => {
    const [requests, matched] = await Promise.all([
      API.getMatchRequests(),
      API.getMyMatches(),
    ]);

    // 401(세션 만료)은 _layout.tsx 가 로그인 화면으로 보내므로 조용히 둔다.
    const failed = [requests, matched].find(
      (r) => r.code !== 200 && r.code !== 401,
    );
    if (failed) {
      Alert.alert("오류", failed.message ?? "활동 내역을 불러오지 못했어요.");
    }

    if (requests.code === 200 && requests.data) setRequests(requests.data);
    if (matched.code === 200 && matched.data) {
      setMatches(matched.data.matches, matched.data.partnerTeams);
    }
  }, [setRequests, setMatches]);

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

  const renderRequestItem = ({ item }: { item: MatchRequest }) => {
    const { partnerTeam: team, received, status } = item;
    // 아직 답을 안 한 '받은 신청'만 상세로 들어가 수락/거절할 수 있다
    const actionable = received && status === "WAITING";
    const muted = !received || status !== "WAITING";
    const view = requestStatusView(item);

    return (
      <PressScale
        scaleTo={0.98}
        style={styles.row}
        disabled={!actionable}
        // 상세 화면은 '신청 한 건'을 연다. 팀 id 로는 어느 신청인지 알 수 없다.
        onPress={() =>
          actionable && router.push(`/match/party/${item.id}` as any)
        }
      >
        <View style={styles.avatarWrap}>
          <View
            style={[styles.avatar, muted && styles.avatarMuted]}
            >
            <Text style={[styles.avatarText, muted && styles.avatarTextMuted]}>
              {team.title.charAt(0)}
            </Text>
          </View>
          {actionable && <View style={styles.newDot} />}
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={styles.title} numberOfLines={1}>
              {team.title}
            </Text>
            <Text style={styles.time}>{item.timestamp}</Text>
          </View>

          <Text style={styles.meta} numberOfLines={1}>
            {team.campus} · {team.dept} · {team.count}명
          </Text>

          <View style={styles.statusRow}>
            <Badge label={view.label} tone={view.tone} />
            <Text style={styles.statusHint}>{view.hint}</Text>
          </View>
        </View>

        {actionable && (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={Palette.gray300}
            style={styles.chevron}
          />
        )}
      </PressScale>
    );
  };

  // 약속 날짜가 지난 매칭은 아래로 내린다. 다음에 만날 약속이 위에 보여야 한다.
  const sortedMatches = useMemo(() => {
    const done = (m: Match) => !!m.confirmedPlan && isPastPlan(m.confirmedPlan.date);
    return [...matches].sort(
      (a, b) => Number(done(a)) - Number(done(b)),
    );
  }, [matches]);

  const renderMatchItem = ({ item }: { item: Match }) => {
    const plan = item.confirmedPlan;
    const completed = !!plan && isPastPlan(plan.date);

    return (
      <View style={completed && styles.completedCard}>
        <PressScale
          scaleTo={0.98}
          style={styles.row}
          onPress={() => router.push(`/chat/${item.id}` as any)}
        >
          <View
            style={[
              styles.avatar,
              completed ? styles.avatarDone : styles.avatarBrand,
            ]}
          >
            <Ionicons
              name={completed ? "checkmark-done" : "chatbubbles"}
              size={20}
              color={completed ? Palette.gray500 : Palette.brand}
            />
          </View>

          <View style={styles.rowBody}>
            <View style={styles.rowTop}>
              <Text
                style={[styles.title, completed && styles.titleDone]}
                numberOfLines={1}
              >
                {item.partnerTeamName}
              </Text>
              <Text style={styles.time}>{item.startedAt}</Text>
            </View>

            <Text style={styles.meta} numberOfLines={1}>
              {plan
                ? formatPlanSummary(plan)
                : "매칭 성사 · 대화를 시작해보세요"}
            </Text>

            <View style={styles.statusRow}>
              {completed ? (
                <Badge label="완료됨" tone="neutral" />
              ) : plan ? (
                <Badge label={`약속 ${dDayLabel(plan.date)}`} tone="brand" />
              ) : (
                <Badge label="채팅중" tone="success" />
              )}
              {!plan && (
                <Text style={styles.statusHint}>
                  만날 날짜를 정하면 여기에 표시돼요
                </Text>
              )}
            </View>
          </View>

          <Ionicons
            name="chevron-forward"
            size={18}
            color={Palette.gray300}
            style={styles.chevron}
          />
        </PressScale>

        {completed && (
          <View style={styles.reviewRow}>
            <Pressable
              onPress={() =>
                Alert.alert("준비중입니다", "후기 기능은 곧 만나볼 수 있어요.")
              }
              style={({ pressed }) => [
                styles.reviewButton,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Ionicons
                name="create-outline"
                size={16}
                color={Palette.gray700}
              />
              <Text style={styles.reviewButtonText}>후기 남기기</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  const emptyByTab = {
    RECEIVED: {
      icon: "mail-outline" as const,
      title: "받은 신청이 없어요",
      description: "팀을 게시판에 공개하면 신청을 받을 수 있어요.",
    },
    SENT: {
      icon: "paper-plane-outline" as const,
      title: "보낸 신청이 없어요",
      description: "마음에 드는 팀에 먼저 신청해보세요.",
    },
    MATCHES: {
      icon: "chatbubbles-outline" as const,
      title: "성사된 매칭이 없어요",
      description: "신청을 수락하면 여기에서 바로 대화할 수 있어요.",
    },
  }[activeTab];

  return (
    <Screen>
      <ScreenHeader title="활동" />

      <Segmented<TabType>
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { value: "RECEIVED", label: "받은 신청", count: receivedList.length },
          { value: "SENT", label: "보낸 신청", count: sentList.length },
          { value: "MATCHES", label: "매칭", count: matches.length },
        ]}
      />

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Palette.brand} />
        </View>
      ) : activeTab === "MATCHES" ? (
        <FlatList
          data={sortedMatches}
          renderItem={renderMatchItem}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <Divider inset={76} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={Palette.brand}
            />
          }
          ListEmptyComponent={<EmptyState {...emptyByTab} />}
        />
      ) : (
        <FlatList
          data={activeTab === "RECEIVED" ? receivedList : sentList}
          renderItem={renderRequestItem}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <Divider inset={76} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={Palette.brand}
            />
          }
          ListEmptyComponent={<EmptyState {...emptyByTab} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingTop: Spacing.sm, paddingBottom: Spacing.xxxl },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.lg,
    backgroundColor: Palette.white,
  },

  avatarWrap: { position: "relative" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray100,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarMuted: { backgroundColor: Palette.gray50 },
  avatarBrand: { backgroundColor: Palette.brandWeak },
  avatarDone: { backgroundColor: Palette.gray100 },
  avatarText: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },
  avatarTextMuted: { color: Palette.gray400 },
  newDot: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: Radius.full,
    backgroundColor: Palette.red,
    borderWidth: 2,
    borderColor: Palette.white,
  },

  rowBody: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  title: { ...Typo.subtitle, fontSize: 16, flex: 1 },
  time: { ...Typo.caption, fontSize: 12, color: Palette.gray400 },
  meta: { ...Typo.caption, marginTop: 3 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  statusHint: { ...Typo.caption, fontSize: 12, flexShrink: 1 },
  chevron: { marginLeft: -Spacing.xs },

  // 지난 약속: 흐리게 눕혀두고 후기 버튼만 또렷하게
  completedCard: { backgroundColor: Palette.gray50 },
  titleDone: { color: Palette.gray600 },
  reviewRow: {
    paddingHorizontal: Spacing.screen,
    paddingBottom: Spacing.lg,
    marginTop: -Spacing.sm,
  },
  reviewButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: Radius.md,
    backgroundColor: Palette.white,
    borderWidth: 1,
    borderColor: Palette.gray200,
  },
  reviewButtonText: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },
});
