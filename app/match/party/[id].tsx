// 파일: app/match/party/[id].tsx
//
// 받은 신청 하나를 열어 상대 팀을 살펴보고 수락/거절하는 화면.
//
// ⚠️ 경로의 [id] 는 '팀 id' 가 아니라 '신청(matches) id' 다.
//    한 팀이 여러 신청을 보낼 수 있고(우리 팀이 여럿이면), 팀 id 만으로는
//    어느 신청에 답하는지 정해지지 않는다.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { MemberProfileSheet } from "@/components/ui/member-profile-sheet";
import { PressScale } from "@/components/ui/press-scale";
import { NavHeader, Screen, SectionGap } from "@/components/ui/screen";
import { getAvatarSource } from "@/constants/avatars";
import {
  CampusColor,
  GenderColor,
  Palette,
  Radius,
  Shadow,
  Spacing,
  Typo,
} from "@/constants/theme";
import { MatchRequest, TeamMember, useStore } from "@/store/useStore";

/** 이미 답한 신청이면 버튼 대신 이 문구를 보여준다 */
const answeredNotice = (status: MatchRequest["status"]) => {
  if (status === "ACCEPTED") {
    return "이미 수락한 신청이에요. [활동 → 매칭] 에서 대화를 이어가세요.";
  }
  return "이미 거절된 신청이에요. 상대 팀이 다른 팀과 매칭되면 자동으로 거절되기도 해요.";
};

export default function MatchPartyDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const myTeams = useStore((state) => state.myTeams);
  const setMyTeams = useStore((state) => state.setMyTeams);
  const setMatches = useStore((state) => state.setMatches);

  const [request, setRequest] = useState<MatchRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  /** 눌러서 연 팀원 프로필. 수락 여부는 결국 이걸 보고 정한다. */
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  // 신청 한 건을 서버에서 직접 읽는다. 활동 탭을 거치지 않고 알림에서
  // 바로 들어와도 화면이 채워져야 한다.
  const load = useCallback(async () => {
    const result = await API.getMatchRequest(String(id));
    if (result.code !== 200 || !result.data) {
      if (result.code !== 401) {
        Alert.alert("오류", result.message ?? "신청을 불러오지 못했어요.", [
          { text: "확인", onPress: () => router.back() },
        ]);
      }
      return;
    }
    setRequest(result.data);
  }, [id, router]);

  /**
   * 내 팀 목록은 [내 팀] 탭이 채운다. 여기는 활동 탭이나 알림에서 바로 들어올
   * 수 있어서, 그때는 비어 있어 "어느 팀으로 온 신청인지"를 못 쓴다.
   *
   * 신청을 읽는 것과 나란히 돌린다. 순서대로 하면 화면이 그만큼 늦게 뜬다.
   * 실패해도 조용히 넘어간다 — 이 화면의 본론인 수락·거절은 서버가 신청 하나만
   * 보고 판단하므로, 머리말 한 줄 때문에 화면을 막을 이유가 없다.
   */
  const loadMyTeams = useCallback(async () => {
    const result = await API.getMyTeams();
    if (result.code === 200 && result.data) {
      setMyTeams(result.data);
    }
  }, [setMyTeams]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.all([load(), loadMyTeams()]);
      if (alive) setIsLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [load, loadMyTeams]);

  /**
   * 수락. 여기서부터는 서버가 다 한다 — 채팅방 생성, 두 팀 MATCHED 전환,
   * 두 팀에 걸려 있던 나머지 신청 자동 거절까지 한 트랜잭션이다.
   * 화면은 그 결과를 다시 읽어서 채팅방으로 넘어가기만 한다.
   */
  const handleAccept = async () => {
    if (!request || isWorking) return;

    setIsWorking(true);
    try {
      const result = await API.acceptMatchRequest(request.id);
      if (result.code !== 200 || !result.data) {
        Alert.alert("수락할 수 없어요", result.message ?? "다시 시도해주세요.");
        await load();
        return;
      }

      // 채팅 화면은 매칭 목록에서 상대 팀을 찾는다. 넘어가기 전에 채워둔다.
      const mine = await API.getMyMatches();
      if (mine.code === 200 && mine.data) {
        setMatches(mine.data.matches, mine.data.partnerTeams);
      }

      Alert.alert("매칭 수락 💖", "채팅방이 열렸어요. 대화를 시작해보세요.", [
        {
          text: "채팅방으로 이동",
          onPress: () => router.replace(`/chat/${result.data!.id}` as any),
        },
      ]);
    } finally {
      setIsWorking(false);
    }
  };

  const handleReject = () => {
    if (!request || isWorking) return;

    Alert.alert("거절하시겠어요?", "이 팀의 신청을 거절합니다.", [
      { text: "취소", style: "cancel" },
      {
        text: "거절하기",
        style: "destructive",
        onPress: async () => {
          setIsWorking(true);
          try {
            const result = await API.rejectMatchRequest(request.id);
            if (result.code !== 200) {
              Alert.alert("오류", result.message ?? "처리하지 못했어요.");
              return;
            }
            router.back();
          } finally {
            setIsWorking(false);
          }
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <Screen tone="grouped">
        <NavHeader title="상대 팀" onBack={() => router.back()} bordered />
        <View style={styles.center}>
          <ActivityIndicator color={Palette.brand} />
        </View>
      </Screen>
    );
  }

  if (!request) {
    return (
      <Screen tone="grouped">
        <NavHeader title="상대 팀" onBack={() => router.back()} bordered />
        <View style={styles.center}>
          <Text style={styles.emptyText}>신청을 찾을 수 없어요.</Text>
        </View>
      </Screen>
    );
  }

  const team = request.partnerTeam;
  const gender = GenderColor[team.gender];
  const campusTone = CampusColor[team.campus];
  const myTeam = myTeams.find((t) => t.id === request.myTeamId);
  const canAnswer = request.received && request.status === "WAITING";

  return (
    <Screen tone="grouped">
      <NavHeader title="상대 팀" onBack={() => router.back()} bordered />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 어느 팀으로 온 신청인지 ────────────────────── */}
        <View style={styles.inbox}>
          <Ionicons name="mail-open-outline" size={16} color={Palette.brand} />
          <Text style={styles.inboxText} numberOfLines={1}>
            {myTeam ? `"${myTeam.title}" 팀으로 온 신청이에요` : "받은 신청"}
          </Text>
          <Text style={styles.inboxTime}>{request.timestamp}</Text>
        </View>

        {/* ── 팀 요약 ──────────────────────────────────── */}
        <View style={styles.header}>
          <View style={[styles.tile, { backgroundColor: gender.bg }]}>
            <Ionicons name={gender.icon} size={26} color={gender.fg} />
          </View>
          <Text style={styles.title}>{team.title}</Text>
          <View style={styles.badgeRow}>
            <Badge label={`${team.campus} 캠퍼스`} colors={campusTone} />
            <Badge label={team.dept} />
            {team.age != null && <Badge label={`평균 ${team.age}세`} />}
          </View>
          <View style={styles.tags}>
            {team.tags.map((tag, i) => (
              <Text key={`${tag}-${i}`} style={styles.tagText}>
                {tag}
              </Text>
            ))}
          </View>
        </View>


        <SectionGap />

        {/* ── 소개글 ───────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💬 팀 소개</Text>
          <Text style={styles.content}>{team.content}</Text>
        </View>


        <SectionGap />

        {/* ── 팀원 ─────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            👥 멤버 {team.members.length}/{team.count}
          </Text>
          <Text style={styles.sectionDesc}>
            눌러서 프로필을 확인할 수 있어요
          </Text>

          {team.members.length === 0 ? (
            <Text style={styles.emptyText}>
              팀원 정보를 볼 수 없어요. (차단했거나 탈퇴한 팀일 수 있어요)
            </Text>
          ) : (
            <View style={styles.memberList}>
              {team.members.map((member, i) => (
                <PressScale
                  key={`${member.name}-${i}`}
                  scaleTo={0.98}
                  style={styles.memberRow}
                  onPress={() => setSelectedMember(member)}
                >
                  <Image
                    source={getAvatarSource(member.avatarIdx)}
                    style={styles.memberAvatar}
                  />
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberMeta} numberOfLines={1}>
                      {[member.dept, member.mbti].filter(Boolean).join(" · ") ||
                        "프로필 보기"}
                    </Text>
                  </View>
                  {member.role === "LEADER" && (
                    <Badge label="팀장" tone="brand" />
                  )}
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={Palette.gray300}
                  />
                </PressScale>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* 팀원 프로필 */}
      <MemberProfileSheet
        member={selectedMember}
        onClose={() => setSelectedMember(null)}
      />

      {/* ── 하단 액션 ────────────────────────────────── */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg }]}>
        {canAnswer ? (
          <View style={styles.footerRow}>
            <PressScale
              scaleTo={0.97}
              style={styles.rejectBtn}
              disabled={isWorking}
              onPress={handleReject}
            >
              <Text style={styles.rejectText}>거절하기</Text>
            </PressScale>

            <PressScale
              scaleTo={0.97}
              style={styles.acceptBtn}
              disabled={isWorking}
              onPress={handleAccept}
            >
              {isWorking ? (
                <ActivityIndicator color={Palette.white} />
              ) : (
                <Text style={styles.acceptText}>수락하고 채팅하기</Text>
              )}
            </PressScale>
          </View>
        ) : (
          <View style={styles.noticeBox}>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={Palette.gray500}
            />
            <Text style={styles.noticeText}>
              {request.received
                ? answeredNotice(request.status)
                : "내가 보낸 신청이에요. 상대의 응답을 기다려주세요."}
            </Text>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { ...Typo.body, color: Palette.gray500 },

  scrollContent: { paddingBottom: 140 },

  inbox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.md,
    backgroundColor: Palette.brandWeak,
  },
  inboxText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: Palette.brandText,
  },
  inboxTime: { ...Typo.caption, fontSize: 12 },

  header: {
    alignItems: "center",
    padding: Spacing.xl,
    backgroundColor: Palette.white,
  },
  tile: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  title: { ...Typo.display, fontSize: 22, textAlign: "center" },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
  },
  tagText: {
    backgroundColor: Palette.gray100,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    color: Palette.gray600,
    fontSize: 12,
    fontWeight: "600",
  },

  section: {
    padding: Spacing.screen,
    backgroundColor: Palette.white,
  },
  sectionTitle: { ...Typo.section, marginBottom: Spacing.md },
  sectionDesc: { ...Typo.caption, marginTop: -Spacing.sm, marginBottom: Spacing.lg },
  content: { ...Typo.body, lineHeight: 24 },

  memberList: { gap: Spacing.sm },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray100,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Palette.gray200,
  },
  memberInfo: { flex: 1 },
  memberName: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray900,
  },
  memberMeta: { ...Typo.caption, marginTop: 2 },

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.md,
    backgroundColor: Palette.white,
    borderTopWidth: 1,
    borderTopColor: Palette.gray200,
    ...Shadow.soft,
  },
  footerRow: { flexDirection: "row", gap: Spacing.md },
  rejectBtn: {
    flex: 1,
    paddingVertical: 17,
    borderRadius: Radius.lg,
    backgroundColor: Palette.gray100,
    alignItems: "center",
  },
  rejectText: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.gray700,
  },
  acceptBtn: {
    flex: 2,
    paddingVertical: 17,
    borderRadius: Radius.lg,
    backgroundColor: Palette.brand,
    alignItems: "center",
  },
  acceptText: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: Palette.white,
  },

  noticeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Palette.gray100,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: Palette.gray600,
  },
});
