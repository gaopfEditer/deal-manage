import type { ChatMessage } from "./types";

/** 每条消息开始显示的帧（相对 Sequence 起点） */
export function buildMessageRevealFrames(
	messages: ChatMessage[],
	fps: number,
	defaultDelayMs: number
): number[] {
	const frames: number[] = [];
	let elapsedMs = 0;
	for (let i = 0; i < messages.length; i++) {
		frames.push(Math.round((elapsedMs / 1000) * fps));
		const delay = messages[i].delayMs ?? defaultDelayMs;
		elapsedMs += Math.max(0, delay);
	}
	return frames;
}

/** 建议 Sequence 时长（帧）：全部消息播完后再留 1.5s */
export function estimateChatDurationFrames(
	messages: ChatMessage[],
	fps: number,
	defaultDelayMs: number,
	tailHoldMs = 1500
): number {
	if (messages.length === 0) return Math.round(1 * fps);
	let elapsedMs = 0;
	for (const m of messages) {
		elapsedMs += Math.max(0, m.delayMs ?? defaultDelayMs);
	}
	return Math.round(((elapsedMs + tailHoldMs) / 1000) * fps);
}
