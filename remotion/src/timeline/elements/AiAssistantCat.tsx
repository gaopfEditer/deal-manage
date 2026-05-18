import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type {
  AiAssistantCatLayer,
  ChatMessage,
  ChatMessageKind,
  ChatParticipant,
} from "../../lib/types";
import { buildMessageRevealFrames } from "../../lib/chatTiming";
import { resolveMediaSrc } from "../../lib/resolveMediaSrc";

type Props = {
  layer: AiAssistantCatLayer;
};

function normalizeChatProps(layer: AiAssistantCatLayer): {
  participants: ChatParticipant[];
  messages: ChatMessage[];
  selfId: string;
  defaultDelayMs: number;
  title?: string;
} {
  const { props } = layer;
  const defaultDelayMs = props.defaultDelayMs ?? 1000;

  if (props.messages?.length) {
    const participants = props.participants ?? [];
    const selfId =
      props.selfId?.trim() ||
      participants.find((p) => p.id === "me")?.id ||
      "me";
    return {
      participants,
      messages: props.messages,
      selfId,
      defaultDelayMs,
      title: props.title,
    };
  }

  const legacyText = props.dialog?.trim();
  if (legacyText) {
    return {
      participants: [{ id: "assistant", nickname: "小墨", avatar: "🐱" }],
      messages: [{ from: "assistant", kind: "text", content: legacyText, delayMs: 0 }],
      selfId: "me",
      defaultDelayMs,
      title: props.title,
    };
  }

  return {
    participants: props.participants ?? [],
    messages: [],
    selfId: props.selfId ?? "me",
    defaultDelayMs,
    title: props.title,
  };
}

function isEmojiAvatar(avatar: string | undefined): boolean {
  if (!avatar) return true;
  const t = avatar.trim();
  if (/^https?:\/\//i.test(t) || t.includes("/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(t)) {
    return false;
  }
  return t.length <= 8;
}

const ParticipantAvatar: React.FC<{ participant: ChatParticipant }> = ({
  participant,
}) => {
  const src = resolveMediaSrc(participant.avatar);
  const fallback = participant.nickname?.slice(0, 1) || "?";

  if (src && !isEmojiAvatar(participant.avatar)) {
    return (
      <Img
        src={src}
        style={{
          width: 72,
          height: 72,
          borderRadius: 12,
          objectFit: "cover",
          flexShrink: 0,
          border: "2px solid rgba(160, 210, 255, 0.35)",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: 72,
        height: 72,
        borderRadius: 12,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        fontSize: 40,
        background:
          "linear-gradient(145deg, rgba(120,200,255,0.35), rgba(40,80,200,0.55))",
        border: "2px solid rgba(200, 230, 255, 0.45)",
      }}
    >
      {participant.avatar?.trim() || fallback}
    </div>
  );
};

const MessageBody: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const kind: ChatMessageKind = message.kind ?? "text";

  if (kind === "emoji") {
    return (
      <div style={{ fontSize: 88, lineHeight: 1, padding: "4px 8px" }}>{message.content}</div>
    );
  }

  if (kind === "image") {
    const src = resolveMediaSrc(message.content);
    if (!src) {
      return <span style={{ opacity: 0.6, fontSize: 26 }}>[图片无效]</span>;
    }
    return (
      <Img
        src={src}
        style={{
          maxWidth: 520,
          maxHeight: 360,
          borderRadius: 12,
          display: "block",
        }}
      />
    );
  }

  if (kind === "red_packet") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 280 }}>
        <div style={{ fontSize: 44, lineHeight: 1 }}>🧧</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#fff5e0" }}>
            {message.content || "恭喜发财，大吉大利"}
          </div>
          <div style={{ fontSize: 22, marginTop: 6, color: "rgba(255,245,220,0.85)" }}>
            微信红包
          </div>
        </div>
      </div>
    );
  }

  return (
    <span
      style={{
        fontSize: 30,
        lineHeight: 1.45,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {message.content}
    </span>
  );
};

type ChatRowProps = {
  message: ChatMessage;
  participant: ChatParticipant;
  isSelf: boolean;
  localFrame: number;
  fps: number;
  isFirstInStack?: boolean;
};

const ChatRow: React.FC<ChatRowProps> = ({
  message,
  participant,
  isSelf,
  localFrame,
  fps,
  isFirstInStack,
}) => {
  const enter = spring({
    frame: localFrame,
    fps,
    config: { damping: 16, stiffness: 180 },
  });

  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const slideY = interpolate(enter, [0, 1], [28, 0]);
  const slideX = interpolate(enter, [0, 1], [isSelf ? 24 : -24, 0]);
  const scale = interpolate(enter, [0, 1], [0.92, 1]);

  const bubbleBg = isSelf
    ? "linear-gradient(135deg, rgba(60, 140, 255, 0.92), rgba(30, 90, 200, 0.88))"
    : "rgba(18, 24, 42, 0.88)";
  const bubbleBorder = isSelf
    ? "1px solid rgba(160, 220, 255, 0.45)"
    : "1px solid rgba(120, 160, 210, 0.35)";

  const kind = message.kind ?? "text";
  const isRedPacket = kind === "red_packet";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isSelf ? "row-reverse" : "row",
        alignItems: "flex-end",
        gap: 14,
        marginTop: isFirstInStack ? 0 : 18,
        flexShrink: 0,
        opacity,
        transform: `translate(${slideX}px, ${slideY}px) scale(${scale})`,
      }}
    >
      <ParticipantAvatar participant={participant} />
      <div
        style={{
          maxWidth: "78%",
          display: "flex",
          flexDirection: "column",
          alignItems: isSelf ? "flex-end" : "flex-start",
        }}
      >
        {!isSelf || message.time ? (
          <div
            style={{
              fontSize: 22,
              color: "rgba(200, 220, 255, 0.65)",
              marginBottom: 6,
              textAlign: isSelf ? "right" : "left",
            }}
          >
            {!isSelf ? participant.nickname : null}
            {message.time ? (
              <span style={{ marginLeft: !isSelf ? 10 : 0 }}>{message.time}</span>
            ) : null}
          </div>
        ) : null}
        <div
          style={{
            padding: isRedPacket ? "16px 20px" : "14px 18px",
            borderRadius: isRedPacket ? 14 : isSelf ? "18px 4px 18px 18px" : "4px 18px 18px 18px",
            background: isRedPacket
              ? "linear-gradient(135deg, #e85a4f 0%, #c62828 55%, #b71c1c 100%)"
              : bubbleBg,
            border: isRedPacket ? "1px solid rgba(255, 200, 120, 0.5)" : bubbleBorder,
            boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
            color: isSelf && !isRedPacket ? "#f0f8ff" : "#e8f0ff",
          }}
        >
          <MessageBody message={message} />
        </div>
      </div>
    </div>
  );
};

export const AiAssistantCat: React.FC<Props> = ({ layer }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { participants, messages, selfId, defaultDelayMs, title } = useMemo(
    () => normalizeChatProps(layer),
    [layer]
  );

  const participantMap = useMemo(() => {
    const m = new Map<string, ChatParticipant>();
    for (const p of participants) {
      m.set(p.id, p);
    }
    return m;
  }, [participants]);

  const revealFrames = useMemo(
    () => buildMessageRevealFrames(messages, fps, defaultDelayMs),
    [messages, fps, defaultDelayMs]
  );

  const visibleMessages = useMemo(() => {
    return messages
      .map((msg, idx) => ({ msg, idx, revealAt: revealFrames[idx] ?? 0 }))
      .filter(({ revealAt }) => frame >= revealAt);
  }, [messages, revealFrames, frame]);

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background: "linear-gradient(180deg, #050814 0%, #0a1020 48%, #050814 100%)",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: "48px 32px 28px",
            borderBottom: "1px solid rgba(80, 130, 200, 0.22)",
            background: "rgba(6, 10, 22, 0.65)",
          }}
        >
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: "#eaf6ff",
              textAlign: "center",
            }}
          >
            {title || "群聊"}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: "16px 28px 56px",
          }}
        >
          {visibleMessages.map(({ msg, idx, revealAt }, visIdx) => {
            const localFrame = frame - revealAt;
            const participant = participantMap.get(msg.from) ?? {
              id: msg.from,
              nickname: msg.from,
              avatar: "?",
            };
            const isSelf = msg.from === selfId;
            return (
              <ChatRow
                key={`${idx}-${msg.from}-${msg.kind ?? "text"}`}
                message={msg}
                participant={participant}
                isSelf={isSelf}
                localFrame={localFrame}
                fps={fps}
                isFirstInStack={visIdx === 0}
              />
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
