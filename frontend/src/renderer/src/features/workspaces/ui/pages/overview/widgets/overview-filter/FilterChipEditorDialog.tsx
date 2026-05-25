import { ListFilter, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { MotionUnderlineTab } from "@/shared/components/motion-tabs";
import { dialogPanelMotion, menuMotion, tightPressTap } from "@/shared/motion";
import {
  cloneOverviewFilterState,
  type CustomChip,
  type CustomChipRule,
  type OverviewFilterState,
} from "../../../../../model/overview-filter";
import { EmptyPanel } from "../../../../shared/workspace-panel-primitives";
import { BasicFilterSettings } from "./BasicFilterSettings";
import { CustomChipCard, CustomChipDraftCard } from "./CustomChipEditor";
import { createDefaultCustomRule } from "./filter-rule-utils";

export function FilterChipEditorDialog({ filter, onApply, onClose }: { filter: OverviewFilterState; onApply: (filter: OverviewFilterState) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"basic" | "custom">("basic");
  const [draftFilter, setDraftFilter] = useState<OverviewFilterState>(() => cloneOverviewFilterState(filter));
  const [draftName, setDraftName] = useState("");
  const [draftRules, setDraftRules] = useState<CustomChipRule[]>([createDefaultCustomRule()]);
  const applyAndClose = () => {
    onApply(cloneOverviewFilterState(draftFilter));
    onClose();
  };
  const saveDraft = () => {
    const name = draftName.trim();
    if (!name) {
      return;
    }

    const rules = draftRules.filter((rule) => rule.metric && rule.operator && rule.value.trim());
    setDraftFilter((current) => ({
      ...current,
      customChips: [...current.customChips, { id: `${Date.now()}`, name, rules, visible: true, active: false }],
    }));
    setDraftName("");
    setDraftRules([createDefaultCustomRule()]);
  };
  const editChip = (chip: CustomChip) => {
    setDraftName(chip.name);
    setDraftRules(chip.rules.length > 0 ? chip.rules.map((rule) => ({ ...rule })) : [createDefaultCustomRule()]);
    setDraftFilter((current) => ({ ...current, customChips: current.customChips.filter((item) => item.id !== chip.id) }));
  };

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={menuMotion.transition} className="fixed inset-0 z-[1200] flex items-center justify-center bg-[#05080dcc] px-6 py-6">
      <motion.div {...dialogPanelMotion} data-app-tour-target="overview-filter-dialog" className="flex h-[min(720px,calc(100vh-48px))] w-[min(706px,calc(100vw-48px))] min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--panel-bg)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
              <ListFilter className="size-4" strokeWidth={1.8} />
            </span>
            <h4 className="min-w-0 truncate text-base font-normal leading-5 text-[var(--primary-text)]">필터 규칙 관리 및 커스텀칩 생성</h4>
          </div>
          <motion.button type="button" onClick={onClose} whileTap={tightPressTap} className="flex size-8 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]" aria-label="닫기">
            <X className="size-4" />
          </motion.button>
        </div>

        <div className="border-y border-[var(--panel-stroke)]">
          <div className="grid grid-cols-2">
            <MotionUnderlineTab label="기본 필터 설정" active={tab === "basic"} onClick={() => setTab("basic")} className="px-4 py-3" underlineId="overview-filter-editor-tabs" />
            <MotionUnderlineTab label="커스텀 칩" active={tab === "custom"} onClick={() => setTab("custom")} className="px-4 py-3" underlineId="overview-filter-editor-tabs" />
          </div>
        </div>

        {tab === "basic" ? (
          <BasicFilterSettings filter={draftFilter} onChange={setDraftFilter} />
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_16px_minmax(0,1fr)]">
            <CustomChipDraftCard
              draftName={draftName}
              rules={draftRules}
              onNameChange={setDraftName}
              onRulesChange={setDraftRules}
              onSave={saveDraft}
            />
            <div />
            <div className="flex min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-transparent p-4">
              <h5 className="mb-3 text-sm font-normal leading-5 text-[var(--primary-text)]">현재 커스텀 칩 목록</h5>
              <div className="app-scrollbar min-h-0 flex-1 overflow-auto">
                {draftFilter.customChips.length === 0 ? (
                  <EmptyPanel text="저장된 커스텀 칩이 없습니다." />
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {draftFilter.customChips.map((chip) => (
                      <CustomChipCard
                        key={chip.id}
                        chip={chip}
                        onToggle={() =>
                          setDraftFilter((current) => ({
                            ...current,
                            customChips: current.customChips.map((item) =>
                              item.id === chip.id
                                ? {
                                    ...item,
                                    visible: !(item.visible ?? true),
                                    active: item.visible === false ? item.active : false,
                                  }
                                : item,
                            ),
                          }))
                        }
                        onEdit={() => editChip(chip)}
                        onDelete={() => setDraftFilter((current) => ({ ...current, customChips: current.customChips.filter((item) => item.id !== chip.id) }))}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-[var(--panel-stroke)] pt-4">
          <div className="grid grid-cols-[1fr_15px_1fr]">
            <motion.button type="button" onClick={applyAndClose} whileTap={tightPressTap} className="wpf-button text-sm font-normal">
              적용
            </motion.button>
            <div />
            <motion.button type="button" onClick={onClose} whileTap={tightPressTap} className="wpf-button text-sm font-normal">
              취소
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
