import { useRef, useState } from 'react';

import type { RunnableSource } from '../../features/codeEditor';
import type { InstrumentableStructure } from '../../instrumentation/instrumentationTypes';

type EditorTab = RunnableSource & {
  readonly id: string;
  readonly name: string;
};

interface EditorTabsOptions {
  readonly fileName: string;
  readonly initialCode: string;
  readonly initialStructure: InstrumentableStructure | null;
}

const PRIMARY_TAB_ID = 'algorithm-source';
const MAX_NEW_TABS = 3;

export function useEditorTabs({
  fileName,
  initialCode,
  initialStructure,
}: EditorTabsOptions) {
  const [primarySource, setPrimarySource] = useState<RunnableSource>({
    code: initialCode,
    revision: 0,
    structure: initialStructure,
  });
  const [tabs, setTabs] = useState<readonly EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState(PRIMARY_TAB_ID);
  const [primaryNameOverride, setPrimaryNameOverride] = useState<{
    readonly source: string;
    readonly value: string;
  } | null>(null);
  const nextTabNumber = useRef(1);
  const nextRevision = useRef(1);
  const activeSourceRevision = useRef(0);

  const primaryName =
    primaryNameOverride?.source === fileName
      ? primaryNameOverride.value
      : fileName;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeSource = activeTab ?? primarySource;

  function addTab() {
    if (tabs.length >= MAX_NEW_TABS) return;

    const tabNumber = nextTabNumber.current;
    nextTabNumber.current += 1;

    const newTab = {
      id: `new-tab-${tabNumber}`,
      name: `untitled-${tabNumber}.js`,
      code: '',
      revision: nextRevision.current,
      structure: activeSource.structure,
    };

    nextRevision.current += 1;
    activeSourceRevision.current = newTab.revision;
    setTabs((currentTabs) => [...currentTabs, newTab]);
    setActiveTabId(newTab.id);
  }

  function closeTab(tabId: string) {
    const tabIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex === -1) return;

    if (activeTabId === tabId) {
      const nextActiveTab = tabs[tabIndex + 1] ?? tabs[tabIndex - 1];
      activeSourceRevision.current =
        nextActiveTab?.revision ?? primarySource.revision;
      setActiveTabId(nextActiveTab?.id ?? PRIMARY_TAB_ID);
    }

    setTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== tabId));
  }

  function renameTab(tabId: string, name: string) {
    const newName = name.trim();

    if (newName) {
      if (tabId === PRIMARY_TAB_ID) {
        setPrimaryNameOverride({ source: fileName, value: newName });
      } else {
        setTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.id === tabId ? { ...tab, name: newName } : tab,
          ),
        );
      }
    }
  }

  function updateActiveCode(value: string) {
    if (value === activeSource.code) return;

    const revision = nextRevision.current;
    nextRevision.current += 1;
    activeSourceRevision.current = revision;

    if (activeTabId === PRIMARY_TAB_ID) {
      setPrimarySource((source) => ({ ...source, code: value, revision }));
      return;
    }

    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === activeTabId ? { ...tab, code: value, revision } : tab,
      ),
    );
  }

  function replacePrimarySource(
    code: string,
    structure: InstrumentableStructure,
  ) {
    if (code === primarySource.code && structure === primarySource.structure) {
      return;
    }

    const revision = nextRevision.current;
    nextRevision.current += 1;
    const source = {
      code,
      revision,
      structure,
    };

    setPrimarySource(source);
    if (activeTabId === PRIMARY_TAB_ID) {
      activeSourceRevision.current = revision;
    }
  }

  function selectTab(tabId: string) {
    const source =
      tabId === PRIMARY_TAB_ID
        ? primarySource
        : tabs.find((tab) => tab.id === tabId);
    if (source === undefined) return;

    activeSourceRevision.current = source.revision;
    setActiveTabId(tabId);
  }

  function isCurrentSource(source: RunnableSource) {
    return source.revision === activeSourceRevision.current;
  }

  return {
    activeSource,
    activeTabId,
    addTab,
    canAddTab: tabs.length < MAX_NEW_TABS,
    closeTab,
    isCurrentSource,
    primaryName,
    primaryTabId: PRIMARY_TAB_ID,
    renameTab,
    replacePrimarySource,
    selectTab,
    tabs,
    updateActiveCode,
  };
}

export type EditorTabsController = ReturnType<typeof useEditorTabs>;
