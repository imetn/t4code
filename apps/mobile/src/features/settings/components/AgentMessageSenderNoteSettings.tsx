import {
  AGENT_MESSAGE_SENDER_NOTE_MAX_CHARS,
  AgentMessageSenderNoteMode,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react-native";
import { useEffect, useEffectEvent, useRef } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { ListChoiceRow as SettingsChoiceRow } from "../../../components/ui/ListChoiceRow";
import { SettingsSection } from "./SettingsSection";

const MODES = {
  off: {
    label: msg("Off (treat as user)"),
    description: msg("Send tool, cross-thread, and scheduled messages without a sender prefix."),
  },
  default: {
    label: msg("Default source notice"),
    description: msg("Identify the calling thread, MCP tool, or scheduled task."),
  },
  custom: {
    label: msg("Custom prefix"),
    description: msg("Prepend your own text before tool, cross-thread, and scheduled messages."),
  },
} satisfies Record<AgentMessageSenderNoteMode, { label: string; description: string }>;

export function AgentMessageSenderNoteSettings(props: {
  mode: AgentMessageSenderNoteMode | null;
  customPrefix: string | null;
  disabled: boolean;
  footer?: string | undefined;
  onChange: (patch: ServerSettingsPatch) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const draftRef = useRef<{ text: string; over: string | null } | undefined>(undefined);

  const takeDraft = (): ServerSettingsPatch => {
    const draft = draftRef.current;
    draftRef.current = undefined;
    if (draft === undefined || draft.over !== props.customPrefix) return {};
    const customPrefix = draft.text.trim();
    return props.customPrefix === null || customPrefix !== props.customPrefix
      ? { agentMessageSenderNote: { customPrefix } }
      : {};
  };

  const flushDraft = () => {
    const patch = takeDraft();
    if (Object.keys(patch).length > 0) props.onChange(patch);
  };

  const saveDraftOnExit = useEffectEvent(() => flushDraft());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves unsent custom sender prefix draft when the screen unmounts
  useEffect(() => () => saveDraftOnExit(), []);

  return (
    <SettingsSection
      title={gt("Agent message sender note")}
      footer={props.footer}
      trailing={
        props.mode === null ? (
          <Text className="text-xs text-foreground-muted">
            <T>Mixed</T>
          </Text>
        ) : null
      }
    >
      {AgentMessageSenderNoteMode.literals.map((mode, index) => (
        <SettingsChoiceRow
          key={mode}
          label={m(MODES[mode].label)}
          description={m(MODES[mode].description)}
          selected={props.mode === mode}
          separated={index > 0}
          disabled={props.disabled}
          onPress={() => {
            const draft = takeDraft().agentMessageSenderNote;
            props.onChange({ agentMessageSenderNote: { ...draft, mode } });
          }}
        />
      ))}
      {props.mode === "custom" ? (
        <View className="gap-2 px-4 py-3">
          <Text className="text-sm text-foreground-muted">
            <T>Prepended before automated messages. Leave empty for no prefix.</T>
          </Text>
          <AppTextInput
            key={props.customPrefix}
            accessibilityLabel={gt("Custom agent message prefix")}
            maxLength={AGENT_MESSAGE_SENDER_NOTE_MAX_CHARS}
            onChangeText={(text) => {
              draftRef.current = { text, over: props.customPrefix };
            }}
            defaultValue={props.customPrefix ?? ""}
            placeholder={
              props.customPrefix === null
                ? gt("Mixed. Enter a prefix for all selected environments.")
                : gt("[Automated message]")
            }
            editable={!props.disabled}
            multiline
            autoCapitalize="sentences"
            className="min-h-20 rounded-xl px-3 py-2 text-base text-foreground"
            onEndEditing={flushDraft}
          />
        </View>
      ) : null}
    </SettingsSection>
  );
}
