import React, { useState } from 'react';
import { ExtensionMetadata, Series} from '@tiyo/common';
import { useRecoilState, useSetRecoilState, useRecoilValue } from 'recoil';
const { ipcRenderer } = require('electron');
import {
  searchExtensionState,
  searchTextState,
  showingFilterDrawerState,
} from '@/renderer/state/searchStates';
import { FS_METADATA } from '@/common/temp_fs_metadata';
import ipcChannels from '@/common/constants/ipcChannels.json';
import { Button } from '@houdoku/ui/components/Button';
import { HelpCircle, Search } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@houdoku/ui/components/Select';
import { Checkbox } from '@houdoku/ui/components/Checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@houdoku/ui/components/Tooltip';
import { Input } from '@houdoku/ui/components/Input';
import { Label } from '@houdoku/ui/components/Label';
import {
  activeSeriesListState,
  importingState,
  importQueueState,
  categoryListState,
} from '@/renderer/state/libraryStates';
import { searchResultState } from '@/renderer/state/searchStates';

interface Props {
  extensionList: ExtensionMetadata[];
  hasFilterOptions: boolean;
  handleSearch: (fresh?: boolean) => void;
  handleSearchFilesystem: (searchPaths: string[]) => void;
}

const SearchControlBar: React.FC<Props> = (props: Props) => {
  const [searchExtension, setSearchExtension] = useRecoilState(searchExtensionState);
  const setSearchText = useSetRecoilState(searchTextState);
  const setShowingFilterDrawer = useSetRecoilState(showingFilterDrawerState);
  const [multiSeriesEnabled, setMultiSeriesEnabled] = useState(false);
  const importing = useRecoilValue(importingState);
  const [importQueue, setImportQueue] = useRecoilState(importQueueState); // 新增
  const searchResult = useRecoilValue(searchResultState); // 新增（获取当前搜索结果）
  const setSearchResult = useSetRecoilState(searchResultState); // 新增：用于逐项从 searchResult 中移除已加入的 series
  const availableCategories = useRecoilValue(categoryListState);
  const activeSeriesList = useRecoilValue(activeSeriesListState);

  // 新增：选择要应用到所有导入项的分类 id（若未选择则不修改原条目的 categories）
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);

  const handleSelectDirectory = async () => {
    const fileList = await ipcRenderer.invoke(
      ipcChannels.APP.SHOW_OPEN_DIALOG,
      true,
      [],
      'Select Series Directory',
    );
    if (fileList.length <= 0) return;

    const selectedPath = fileList[0];

    const searchPaths = multiSeriesEnabled
      ? await ipcRenderer.invoke(ipcChannels.FILESYSTEM.LIST_DIRECTORY, selectedPath)
      : [selectedPath];

    props.handleSearchFilesystem(searchPaths);
  };

  /**
   * 保存全部查询结果
   */
  const handleSaveAllDirectory = () => {
    if (!searchResult || !Array.isArray(searchResult.seriesList) || searchResult.seriesList.length === 0) return;

    // 过滤：剔除已经在库中的 series（根据 sourceId 判定相同）
    const existingSourceIds = new Set(activeSeriesList.map((s: Series) => s.sourceId));
    const list = [...searchResult.seriesList].filter((item: Series) => {
      // 若没有 sourceId 则保留（无法判定），否则排除已存在的 sourceId
      if (!item.sourceId) return true;
      return !existingSourceIds.has(item.sourceId);
    });
    // 若全部被过滤掉则直接清空
    if (list.length === 0) {
      setSearchResult({ seriesList: [], hasMore: false });
      return;
    }

    // 如果选择了分类，则在加入队列时把该分类应用到每个 series 的 categories 字段
    const toAdd = list.map((item) => {
      const newSeries = {
        ...item,
        categories:
          selectedCategoryId !== undefined
            ? // 覆盖或设置 categories 为所选分类
              [selectedCategoryId]
            : item.categories,
      } as Series;
      return { series: newSeries, getFirst: true };
    });

    // 一次性追加所有项（性能更好），使用函数式 setter 避免并发写入问题
    setImportQueue((prev) => [...prev, ...toAdd]);

    // 优化：保存全部后直接清空 searchResult，避免逐项移除或并发问题
    setSearchResult({ seriesList: [], hasMore: false });
  };

  const renderFilesystemControls = () => {
    return (
      <div className="flex space-x-4">
        <Button onClick={handleSelectDirectory}>选择目录</Button>
        <Button onClick={handleSaveAllDirectory}>全部保存</Button>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex space-x-2 items-center">
                <Checkbox
                  id="checkboxMultiSeriesMode"
                  checked={multiSeriesEnabled}
                  onCheckedChange={() => setMultiSeriesEnabled(!multiSeriesEnabled)}
                />
                <Label
                  htmlFor="checkboxMultiSeriesMode"
                  className="flex text-sm font-medium items-center space-x-2"
                >
                  <span>多选模式</span>
                  <HelpCircle className="w-4 h-4" />
                </Label>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>
                启用多系列模式时，所选目录中的每个项目都被视为单独的系列
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex space-x-2 items-center">
          {/* 分类下拉：选择后在保存时应用到所有导入项 */}
          <Select
            defaultValue={selectedCategoryId ?? '__none'}
            onValueChange={(value) => setSelectedCategoryId(value === '__none' ? undefined : value || undefined)}
          >
            <SelectTrigger className="max-w-52">
              <SelectValue placeholder="Category (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {/* 首项为不选择分类，value 不能是空字符串 */}
                <SelectItem key="none" value="__none">
                  默认分类
                </SelectItem>
                {availableCategories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  const renderStandardControls = () => {
    return (
      <>
        <form
          className="flex flex-1 space-x-2"
          onSubmit={() => {
            props.handleSearch(true);
            return false;
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8 w-full"
              placeholder="Search for a series..."
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        {props.hasFilterOptions ? (
          <Button variant="secondary" onClick={() => setShowingFilterDrawer(true)}>
            Options
          </Button>
        ) : undefined}
      </>
    );
  };

  return (
    <div className="flex space-x-2 py-3">
      <Select
        defaultValue={searchExtension}
        onValueChange={(value) => setSearchExtension(value || searchExtension)}
      >
        <SelectTrigger className="max-w-52">
          <SelectValue placeholder="Select extension" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.extensionList
              .map((metadata: ExtensionMetadata) => ({
                value: metadata.id,
                label: metadata.name,
              }))
              .map((metadata) => (
                <SelectItem key={metadata.value} value={metadata.value}>
                  {metadata.label}
                </SelectItem>
              ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {searchExtension === FS_METADATA.id ? renderFilesystemControls() : renderStandardControls()}
    </div>
  );
};

export default SearchControlBar;
