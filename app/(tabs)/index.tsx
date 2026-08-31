// 파일: app/(tabs)/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { BalanceChoice, BalanceGame } from "@/api/client";
import { DailySection } from "@/components/home/daily-section";
import { FeedRow } from "@/components/home/feed-row";
import { ProfileBanner } from "@/components/home/profile-banner";
import MeetDanLogo from "@/components/Logo";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import { EmptyHint, EmptyState } from "@/components/ui/empty-state";
import { PressScale } from "@/components/ui/press-scale";
import {
  Divider,
  Screen,
  ScreenHeader,
  SectionGap,
  SectionHeader,
} from "@/components/ui/screen";
import {
  GenderColor,
  Palette,
  Radius,
  Shadow,
  Spacing,
  Typo,
} from "@/constants/theme";
import { getDailyFortune } from "@/utils/fortune";
import { getProfileProgress } from "@/utils/profile-progress";
import { useStore, Team } from "../../store/useStore";

type CampusFilter = "전체" | "죽전" | "천안";
const CAMPUS_FILTERS: CampusFilter[] = ["전체", "죽전", "천안"];

/**
 * 팀 글이 이보다 많으면 "오늘의 질문"을 한 줄로 접어둔다.
 *
 * 운세와 밸런스 게임은 게시글 부족을 메우려고 넣은 것이다. 목록이 자기
 * 힘으로 화면을 채우기 시작하면 위쪽 자리를 내줘야 한다. 접힌 줄을 누르면
 * 언제든 다시 펼 수 있다.
 */
const COLLAPSE_AFTER = 8;

/** 하루가 바뀌었는지만 보면 되므로 시:분은 버린다. */
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export default function HomeTab() {
  const router = useRouter();
  const posts = useStore((state) => state.posts);
  const setPosts = useStore((state) => state.setPosts);
  const currentUser = useStore((state) => state.currentUser);
  const unreadCount = useStore((state) => state.unreadCount);
  const setUnreadCount = useStore((state) => state.setUnreadCount);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 운세는 날짜가 씨앗이다. 앱을 켜둔 채 자정을 넘기는 사람이 있으므로
  // 탭에 들어올 때마다 날이 바뀌었는지 확인한다. 같은 날이면 이전 Date를
  // 그대로 두어(=참조가 안 바뀌어) 운세를 다시 계산하지 않는다.
  const [today, setToday] = useState(() => new Date());

  /**
   * 오늘의 밸런스 게임. 질문도 집계도 서버가 준다.
   *
   * 마이그레이션 016 을 아직 안 돌렸으면 null 로 남고 그 줄은 그리지 않는다.
   * 게시판이 그것 때문에 막히면 안 된다.
   */
  const [balance, setBalance] = useState<BalanceGame | null>(null);

  // 기본값은 내 캠퍼스. 아직 내 정보가 안 왔으면 전체로 두고 도착하면 한 번만 맞춘다.
  const [campus, setCampus] = useState<CampusFilter>(
    currentUser?.campus ?? "전체",
  );
  const didApplyMyCampus = useRef(currentUser != null);

  useEffect(() => {
    if (didApplyMyCampus.current || !currentUser) return;
    didApplyMyCampus.current = true;
    setCampus(currentUser.campus);
  }, [currentUser]);

  /**
   * 게시판은 서버가 유일한 출처다. 무엇이 보이는지(공개 팀만, 차단 제외,
   * 내 팀 제외)는 전부 API.getPosts 안에서 정해지므로 여기서 더 거르지 않는다.
   */
  const reload = useCallback(async () => {
    // 안 읽은 알림 개수도 같이 물어본다. 평소에는 Realtime 구독(_layout.tsx)이
    // 뱃지를 실시간으로 올리지만, 앱이 백그라운드에 있는 동안 구독이 끊겼다
    // 붙으면 그 사이 도착한 알림을 놓친다. 홈에 돌아올 때마다 한 번씩 맞춘다.
    const [result, unread, game] = await Promise.all([
      API.getPosts(),
      API.getUnreadNotificationCount(),
      API.getBalanceGame(),
    ]);

    if (unread.code === 200 && unread.data !== undefined) {
      setUnreadCount(unread.data);
    }

    // 밸런스 게임은 실패해도 조용히 넘어간다. 읽을거리 한 줄 때문에
    // 게시판 전체가 오류창에 막히면 안 된다.
    setBalance(game.code === 200 && game.data ? game.data : null);

    if (result.code !== 200 || !result.data) {
      // 401(세션 만료)은 _layout.tsx 가 로그인 화면으로 보내므로 조용히 둔다.
      if (result.code !== 401) {
        Alert.alert("오류", result.message ?? "게시글을 불러오지 못했어요.");
      }
      return;
    }
    setPosts(result.data);
  }, [setPosts, setUnreadCount]);

  // 다른 팀이 방금 공개됐을 수도, 내가 신청한 팀이 매칭되어 내려갔을 수도 있다.
  // 탭에 들어올 때마다 다시 읽는다.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setToday((prev) => {
        const now = new Date();
        return dayKey(prev) === dayKey(now) ? prev : now;
      });
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

  const visible = useMemo(
    () => (campus === "전체" ? posts : posts.filter((t) => t.campus === campus)),
    [posts, campus],
  );

  // 같은 사람·같은 날이면 늘 같은 운세다. 새로고침할 때마다 점수가 바뀌면
  // 그건 운세가 아니라 난수 표시기라서, 계산은 유저와 날짜에만 매단다.
  const fortune = useMemo(
    () =>
      currentUser
        ? getDailyFortune({
            userId: currentUser.id,
            campus: currentUser.campus,
            now: today,
          })
        : null,
    [currentUser, today],
  );

  // 다 채운 사람에게는 null 이 아니라 isComplete 로 돌아온다. 그 줄은 그리지 않는다.
  const progress = useMemo(
    () => getProfileProgress(currentUser),
    [currentUser],
  );

  // 팀 글이 충분히 쌓이면 "오늘의 질문"은 접어둘 수 있다. 접힌 걸 편 상태는
  // 이 화면을 떠날 때까지만 기억한다 — 매번 켤 때마다 목록이 주인공이어야 한다.
  const [dailyExpanded, setDailyExpanded] = useState(false);
  const dailyCollapsible = visible.length > COLLAPSE_AFTER;

  /**
   * 투표. 서버 왕복을 기다렸다 그리면 누른 느낌이 죽으므로 먼저 반영하고
   * 서버가 준 집계로 맞춘다. 실패하면 누르기 전으로 되돌린다.
   */
  const handleVote = useCallback(
    async (choice: BalanceChoice) => {
      const before = balance;
      if (!before || before.myChoice) return;

      setBalance({
        ...before,
        myChoice: choice,
        votesA: before.votesA + (choice === "A" ? 1 : 0),
        votesB: before.votesB + (choice === "B" ? 1 : 0),
      });

      const result = await API.voteBalanceGame(before.questionId, choice);
      if (result.code === 200 && result.data) {
        setBalance(result.data);
        return;
      }

      setBalance(before);
      if (result.code !== 401) {
        Alert.alert("오류", result.message ?? "투표하지 못했어요.");
      }
    },
    [balance],
  );

  const renderItem = ({ item: team }: { item: Team }) => {
    const gender = GenderColor[team.gender];
    const full = team.currentCount >= team.count;

    return (
      <FeedRow
        icon={gender.icon}
        tile={gender}
        tileCaption={`${team.currentCount}/${team.count}`}
        title={team.title}
        // 당근이 "동네 · 시간"을 한 줄에 몰아넣는 자리.
        // 캠퍼스·학과·평균나이·올라온 시각을 한 줄로 붙인다.
        meta={[
          `${team.campus} · ${team.dept}`,
          team.age != null ? `평균 ${team.age}세` : null,
          team.timestamp,
        ]
          .filter(Boolean)
          .join(" · ")}
        // 소개 미리보기. 목록에서 팀 성격이 드러나야 들어가 볼 마음이 든다.
        excerpt={team.content?.trim() || undefined}
        onPress={() => router.push(`/post/${team.id}` as any)}
      >
        {/*
          뱃지는 하나만 남긴다. 예전에는 여기에 자리 수 뱃지와 태그 알약
          두 개가 함께 붙었는데, 알약이 세 개씩 달린 줄이 화면을 채우면
          정작 중요한 "들어갈 자리가 있나"가 묻힌다.
          태그는 상세 화면에서 본다 — 목록에서 팀을 고르는 기준이 아니다.
        */}
        {full ? (
          <Badge label="모집 완료" tone="success" />
        ) : (
          <Badge label={`${team.count - team.currentCount}자리 남음`} />
        )}
      </FeedRow>
    );
  };

  return (
    <Screen>
      <ScreenHeader
        title={
          <View style={styles.brand}>
            <MeetDanLogo size={30} showText={false} />
            <Text style={styles.brandName}>밋단</Text>
          </View>
        }
        subtitle="단국대 과팅, 팀으로 만나요"
        right={
          <Pressable
            hitSlop={8}
            style={styles.iconButton}
            onPress={() => router.push("/notifications" as any)}
          >
            <Ionicons
              name={unreadCount > 0 ? "notifications" : "notifications-outline"}
              size={24}
              color={unreadCount > 0 ? Palette.brand : Palette.gray700}
            />
            {/* 개수까지 적지 않는다. 몇 개인지는 들어가서 보면 되고,
                작은 점 하나가 "뭔가 있다"를 가장 조용히 말한다. */}
            {unreadCount > 0 && <View style={styles.unreadDot} />}
          </Pressable>
        }
      />

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Palette.brand} />
        </View>
      ) : (
        <FlatList
          data={visible}
          renderItem={renderItem}
          keyExtractor={(item) => item.id.toString()}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={Palette.brand}
            />
          }
          ItemSeparatorComponent={() => <Divider inset={Spacing.screen} />}
          ListHeaderComponent={
            <View>
              {/* 할 일 한 줄. 읽을거리(오늘의 질문)와 같은 상자에 담지 않는다 —
                  "뭘 볼까"와 "뭘 해야 하지"가 섞이면 화면이 더 산만해진다. */}
              {!!progress && !progress.isComplete && (
                <ProfileBanner
                  progress={progress}
                  // 탭 이동이라 push가 아니라 navigate. 홈 위에 마이 탭이 쌓이면
                  // 뒤로가기 동작이 탭바와 어긋난다.
                  onPress={() => router.navigate("/(tabs)/profile" as any)}
                />
              )}

              <DailySection
                fortune={fortune}
                balance={balance}
                onVote={handleVote}
                collapsible={dailyCollapsible}
                expanded={!dailyCollapsible || dailyExpanded}
                onToggle={() => setDailyExpanded((prev) => !prev)}
              />

              {/* 회색 띠 한 줄이 "여기서부터는 진짜 팀 글"이라고 말한다.
                  이게 없으면 위의 읽을거리들이 게시글인 척 섞여 보인다. */}
              <SectionGap />

              {/* 0은 굳이 적지 않는다. 아래 빈 화면 안내가 이미 그 말을 한다. */}
              <SectionHeader
                title="지금 열린 팀"
                count={visible.length > 0 ? visible.length : undefined}
              />

              {/* 필터는 스크롤을 따라 올라간다. 목록이 주인공이라 위쪽을
                  고정 요소로 채우지 않는다. */}
              <View style={styles.filterRow}>
                {CAMPUS_FILTERS.map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    selected={campus === c}
                    onPress={() => setCampus(c)}
                  />
                ))}
              </View>
              <Divider />
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="sparkles-outline"
              title="아직 열린 과팅이 없어요"
              description={
                campus === "전체"
                  ? "첫 번째 팀을 만들어 상대를 기다려보세요."
                  : `${campus} 캠퍼스에 올라온 팀이 없어요.`
              }
              actionLabel="팀 만들기"
              onAction={() => router.push("/write")}
            >
              <EmptyHint
                icon="people-outline"
                text="팀은 2~4명까지 모을 수 있어요"
              />
              <EmptyHint
                icon="ticket-outline"
                text="초대 코드로 친구를 부를 수 있어요"
              />
            </EmptyState>
          }
        />
      )}

      {/* 글쓰기는 헤더 구석의 작은 아이콘보다 떠 있는 버튼이 훨씬 잘 눌린다 */}
      <PressScale
        scaleTo={0.94}
        style={styles.fab}
        onPress={() => router.push("/write")}
      >
        <Ionicons name="add" size={22} color={Palette.white} />
        <Text style={styles.fabText}>팀 만들기</Text>
      </PressScale>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  brandName: Typo.display,

  iconButton: { padding: 4 },
  unreadDot: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 8,
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Palette.red,
    // 아이콘 획과 점이 붙어 보이지 않게 배경색으로 한 겹 띄운다
    borderWidth: 1.5,
    borderColor: Palette.white,
  },

  loading: { flex: 1, alignItems: "center", justifyContent: "center" },

  filterRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.screen,
    paddingBottom: Spacing.md,
  },

  listContent: { paddingBottom: 108 },

  // 목록 한 줄의 모양(색 타일 + 제목/메타/미리보기)은 components/home/feed-row.tsx
  // 한곳에 있다. 팀 글·운세·프로필 안내가 같은 골격을 써야 하기 때문이다.

  fab: {
    position: "absolute",
    right: Spacing.screen,
    bottom: Spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xl,
    height: 52,
    borderRadius: Radius.full,
    backgroundColor: Palette.brand,
    ...Shadow.soft,
  },
  fabText: {
    color: Palette.white,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
});
