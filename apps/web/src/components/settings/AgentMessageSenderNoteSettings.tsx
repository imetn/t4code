import {
  AGENT_MESSAGE_SENDER_NOTE_MAX_CHARS,
  AgentMessageSenderNoteMode,
  DEFAULT_SERVER_SETTINGS,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { msg, useGT, useMessages } from "gt-react";
import { useRef } from "react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const SENDER_NOTE_MODE_LABELS: Record<AgentMessageSenderNoteMode, string> = {
  off: msg("Off (treat as user)"),
  default: msg("Default source notice"),
  custom: msg("Custom prefix"),
};

const SENDER_NOTE_MODE_DESCRIPTIONS: Record<AgentMessageSenderNoteMode, string> = {
  off: msg(
    "Send MCP tool, cross-thread, and scheduled messages without a sender prefix so agents treat them like your own messages.",
  ),
  default: msg(
    "Prepend the built-in notice identifying the calling thread, MCP tool, or scheduled task.",
  ),
  custom: msg("Prepend your own text before MCP tool, cross-thread, and scheduled messages."),
};

const isSenderNoteMode = Schema.is(AgentMessageSenderNoteMode);

export function AgentMessageSenderNoteSettings() {
  const gt = useGT();
  const messages = useMessages();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const updateSettings = useUpdateScopedSettings();
  const customPrefixRef = useRef<HTMLTextAreaElement | null>(null);
  const edited = useRef(false);

  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const note = settings.agentMessageSenderNote;
  const defaults = DEFAULT_SERVER_SETTINGS.agentMessageSenderNote;

  const fieldMixed = (field: keyof ServerSettings["agentMessageSenderNote"]) => {
    const first = targets[0];
    return (
      first !== undefined &&
      targets.some(
        (candidate) =>
          candidate.settings.agentMessageSenderNote[field] !==
          first.settings.agentMessageSenderNote[field],
      )
    );
  };

  const modeMixed = fieldMixed("mode");
  const customPrefixMixed = fieldMixed("customPrefix");
  const isDefault =
    !modeMixed &&
    !customPrefixMixed &&
    note.mode === defaults.mode &&
    note.customPrefix === defaults.customPrefix;

  return (
    <SettingsRow
      serverScoped
      settingKeys={["agentMessageSenderNote"]}
      {...searchableSetting("agent-message-sender-note")}
      description={
        modeMixed
          ? gt("The selected environments use different sender note modes.")
          : messages(SENDER_NOTE_MODE_DESCRIPTIONS[note.mode])
      }
      resetAction={
        isDefault ? null : (
          <SettingResetButton
            ariaLabel={gt("Reset agent message sender note to default")}
            onClick={() => {
              edited.current = false;
              updateSettings({ agentMessageSenderNote: { ...defaults } });
            }}
          />
        )
      }
      control={
        <Select
          value={modeMixed ? null : note.mode}
          onValueChange={(value) => {
            if (isSenderNoteMode(value)) {
              const customPrefix = edited.current
                ? customPrefixRef.current?.value.trim()
                : undefined;
              edited.current = false;
              updateSettings({
                agentMessageSenderNote: {
                  mode: value,
                  ...(customPrefix !== undefined ? { customPrefix } : {}),
                },
              });
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={gt("Agent message sender note")}
          >
            <SelectValue>
              {(value: AgentMessageSenderNoteMode | null) =>
                value === null ? gt("Mixed") : messages(SENDER_NOTE_MODE_LABELS[value])
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {AgentMessageSenderNoteMode.literals.map((mode) => (
              <SelectItem key={mode} hideIndicator value={mode}>
                {messages(SENDER_NOTE_MODE_LABELS[mode])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    >
      {!modeMixed && note.mode === "custom" ? (
        <div className="mt-3 max-w-2xl pb-3.5">
          <Textarea
            key={`${scopeKey}:${customPrefixMixed}:${note.customPrefix}`}
            ref={customPrefixRef}
            aria-label={gt("Custom agent message prefix")}
            maxLength={AGENT_MESSAGE_SENDER_NOTE_MAX_CHARS}
            rows={3}
            onChange={() => {
              edited.current = true;
            }}
            defaultValue={customPrefixMixed ? "" : note.customPrefix}
            placeholder={
              customPrefixMixed
                ? gt("Mixed. Enter a prefix to apply to all selected environments.")
                : gt("[Automated message] Leave empty to send without a prefix.")
            }
            onBlur={(event) => {
              const customPrefix = event.target.value.trim();
              if (edited.current && (customPrefixMixed || customPrefix !== note.customPrefix)) {
                updateSettings({ agentMessageSenderNote: { customPrefix } });
              }
              edited.current = false;
            }}
          />
        </div>
      ) : null}
    </SettingsRow>
  );
}
