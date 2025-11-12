import React, { useEffect, useState } from 'react';
import { Series } from '@tiyo/common';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import LibraryControlBar from './LibraryControlBar';
import { LibrarySort, LibraryView, ProgressFilter } from '@/common/models/types';
import {
  activeSeriesListState,
  chapterListState,
  filterState,
  multiSelectEnabledState,
  seriesListState,
  seriesState,
} from '@/renderer/state/libraryStates';
import {
  libraryFilterStatusState,
  libraryFilterProgressState,
  librarySortState,
  libraryViewState,
  libraryFilterCategoryState,
} from '@/renderer/state/settingStates';
import LibraryGrid from './LibraryGrid';
import LibraryList from './LibraryList';
import library from '@/renderer/services/library';
import LibraryControlBarMultiSelect from './LibraryControlBarMultiSelect';
import { ScrollArea } from '@houdoku/ui/components/ScrollArea';
import { RemoveSeriesDialog } from './RemoveSeriesDialog';

type Props = unknown;

/**
 * Library 组件
 *
 * 负责渲染图书馆主视图：展示已添加到库中的 series（可切换网格/列表视图），
 * 提供过滤、排序、多选和删除等操作入口。
 */
const Library: React.FC<Props> = () => {
  // 控制删除模态框的显示和传入待删除的 series
  const [removeModalShowing, setRemoveModalShowing] = useState(false);
  const [removeModalSeries, setRemoveModalSeries] = useState<Series | null>(null);

  // 从 recoil 读取计算后的“活跃” series 列表（通常是 selector，根据全局 seriesListState + 其它状态计算）
  const activeSeriesList = useRecoilValue(activeSeriesListState);

  // 多选模式的状态（用于切换头部为多选工具条）
  const [multiSelectEnabled, setMultiSelectEnabled] = useRecoilState(multiSelectEnabledState);

  // 搜索栏的文本过滤（全局）
  const filter = useRecoilValue(filterState);

  // 各种来自设置/state 的过滤与排序条件
  const libraryFilterCategory = useRecoilValue(libraryFilterCategoryState);
  const libraryFilterStatus = useRecoilValue(libraryFilterStatusState);
  const libraryFilterProgress = useRecoilValue(libraryFilterProgressState);
  const libraryView = useRecoilValue(libraryViewState);
  const librarySort = useRecoilValue(librarySortState);

  // 用于在切换到某个 series 时设置当前 series / series 列表 / chapter 列表
  const setSeries = useSetRecoilState(seriesState);
  const setSeriesList = useSetRecoilState(seriesListState);
  const setChapterList = useSetRecoilState(chapterListState);

  // 初始 mount 时清理当前上下文并关闭多选（避免残留状态）
  useEffect(() => {
    setSeries(undefined);
    setChapterList([]);
    setMultiSelectEnabled(false);
  }, []);

  /**
   * getFilteredList
   *
   * 根据当前的过滤、进度、分类、状态和排序设置从 activeSeriesList 得到最终展示列表。
   * - 会剔除 preview（预览）项
   * - 名称搜索为不区分大小写的 includes
   * - 对于进度过滤，使用 numberUnread 字段判断
   * - 最后根据 librarySort 进行排序
   */
  const getFilteredList = (): Series[] => {
    const filteredList = activeSeriesList.filter((series: Series) => {
      if (!series) return false;

      // 预览条目不显示在库中
      if (series.preview) return false;

      // 文本过滤（标题）
      if (!series.title.toLowerCase().includes(filter.toLowerCase())) return false;

      // 状态过滤（例如 ongoing/finished）
      if (libraryFilterStatus !== null && series.status !== libraryFilterStatus) {
        return false;
      }

      // 进度过滤：未读、已读完成等
      if (libraryFilterProgress === ProgressFilter.Unread && series.numberUnread === 0) {
        return false;
      }
      if (libraryFilterProgress === ProgressFilter.Finished && series.numberUnread > 0) {
        return false;
      }

      // 分类过滤（如果选了分类，需要在 series.categories 中存在）
      if (libraryFilterCategory) {
        if (!series.categories || !series.categories.includes(libraryFilterCategory)) return false;
      }

      return true;
    });

    // 根据当前排序设置对 filteredList 排序并返回
    switch (librarySort) {
      case LibrarySort.UnreadAsc:
        return filteredList.sort((a: Series, b: Series) => a.numberUnread - b.numberUnread);
      case LibrarySort.UnreadDesc:
        return filteredList.sort((a: Series, b: Series) => b.numberUnread - a.numberUnread);
      case LibrarySort.TitleAsc:
        return filteredList.sort((a: Series, b: Series) => a.title.localeCompare(b.title));
      case LibrarySort.TitleDesc:
        return filteredList.sort((a: Series, b: Series) => b.title.localeCompare(a.title));
      default:
        return filteredList;
    }
  };

  /**
   * renderLibrary
   *
   * 根据当前视图（网格/列表）渲染具体组件，并注入删除模态相关的回调。
   * LibraryGrid / LibraryList 会接收 getFilteredList 来获得最终展示数据。
   */
  const renderLibrary = () => {
    return (
      <>
        <RemoveSeriesDialog
          series={removeModalSeries}
          showing={removeModalShowing}
          setShowing={setRemoveModalShowing}
        />

        {libraryView === LibraryView.List ? (
          <LibraryList
            getFilteredList={getFilteredList}
            showRemoveModal={(series) => {
              setRemoveModalSeries(series);
              setRemoveModalShowing(true);
            }}
          />
        ) : (
          <LibraryGrid
            getFilteredList={getFilteredList}
            showRemoveModal={(series) => {
              setRemoveModalSeries(series);
              setRemoveModalShowing(true);
            }}
          />
        )}
      </>
    );
  };

  // 当图书馆为空时显示提示信息
  const renderEmptyMessage = () => {
    return (
      <div className="flex items-center justify-center pt-[30vh]">
        <div className="max-w-[460px]">
          <p className="text-center">
            Your library is empty. Install{' '}
            <code className="relative bg-muted px-[0.3rem] py-[0.2rem] text-sm font-semibold">
              Plugins
            </code>{' '}
            from the tab on the left, and then go to{' '}
            <code className="relative bg-muted px-[0.3rem] py-[0.2rem] text-sm font-semibold">
              Add Series
            </code>{' '}
            to start building your library.
          </p>
        </div>
      </div>
    );
  };

  // 当有库但没有任何条目匹配当前过滤时显示提示
  const renderNoneMatchMessage = () => {
    return (
      <div className="flex items-center justify-center pt-[30vh]">
        <div className="max-w-[500px]">
          <p className="text-center">
            There are no series in your library which match the current filters.
          </p>
        </div>
      </div>
    );
  };

  // 挂载时从持久化层获取 series 列表并写入 recoil 的 seriesListState
  useEffect(() => setSeriesList(library.fetchSeriesList()), [setSeriesList]);

  return (
    <div>
      {/* 头部：根据是否启用多选选择不同的控制条 */}
      {multiSelectEnabled ? (
        <LibraryControlBarMultiSelect
          showAssignCategoriesModal={() => console.log('TODO placeholder')}
        />
      ) : (
        <LibraryControlBar getFilteredList={getFilteredList} />
      )}

      {/* 主显示区：使用 ScrollArea 包裹以支持滚动 */}
      <ScrollArea className="h-[calc(100vh-20px-64px)] w-full pr-4 -mr-2">
        {/* 空库提示 */}
        {activeSeriesList.length === 0 && renderEmptyMessage()}
        {/* 库存在但无匹配项时提示 */}
        {activeSeriesList.length > 0 && getFilteredList().length === 0 && renderNoneMatchMessage()}
        {/* 正常渲染库内容 */}
        {activeSeriesList.length > 0 && getFilteredList().length > 0 && renderLibrary()}
      </ScrollArea>
    </div>
  );
};

export default Library;
