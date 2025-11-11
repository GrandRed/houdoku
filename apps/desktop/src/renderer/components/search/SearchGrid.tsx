const fs = require('fs');
import React, { useEffect, useRef } from 'react';
const { ipcRenderer } = require('electron');
import { Series } from '@tiyo/common';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import ipcChannels from '@/common/constants/ipcChannels.json';
import { libraryColumnsState, libraryCropCoversState } from '@/renderer/state/settingStates';
import {
  searchResultState,
  addModalEditableState,
  addModalSeriesState,
  showingAddModalState,
  searchExtensionState,
} from '@/renderer/state/searchStates';
import { FS_METADATA } from '@/common/temp_fs_metadata';
import ExtensionImage from '../general/ExtensionImage';
import SearchGridContextMenu from './SearchGridContextMenu';
import { ContextMenu, ContextMenuTrigger } from '@houdoku/ui/components/ContextMenu';
import { cn } from '@houdoku/ui/util';
import { Skeleton } from '@houdoku/ui/components/Skeleton';
import { ScrollArea } from '@houdoku/ui/components/ScrollArea';

// 确保缩略图缓存目录存在：组件渲染前通过主进程获取路径并创建目录（用于缓存封面缩略图）
const thumbnailsDir = await ipcRenderer.invoke(ipcChannels.GET_PATH.THUMBNAILS_DIR);
if (!fs.existsSync(thumbnailsDir)) {
  fs.mkdirSync(thumbnailsDir);
}

type Props = {
  loading: boolean;
  handleSearch: (fresh?: boolean) => void;
};

// SearchGrid 组件：负责将 searchResult 的 seriesList 渲染成可点击的缩略图网格
const SearchGrid: React.FC<Props> = (props: Props) => {
  // viewport 引用用于实现无限滚动（监听滚动事件）
  const viewportRef = useRef<HTMLDivElement>(null);
  // 从 recoil 获取当前搜索结果和展示相关设置
  const searchResult = useRecoilValue(searchResultState);
  const libraryColumns = useRecoilValue(libraryColumnsState);
  const libraryCropCovers = useRecoilValue(libraryCropCoversState);
  const searchExtension = useRecoilValue(searchExtensionState);
  // 用于控制“添加 series”模态框的 state
  const setAddModalSeries = useSetRecoilState(addModalSeriesState);
  const setAddModalEditable = useSetRecoilState(addModalEditableState);
  const [showingAddModal, setShowingAddModal] = useRecoilState(showingAddModalState);

  // 点击缩略图时打开添加模态框，editable 依据当前 extension 判断（文件系统来源可编辑）
  const handleOpenAddModal = (series: Series) => {
    setAddModalSeries(series);
    setAddModalEditable(searchExtension === FS_METADATA.id);
    setShowingAddModal(!showingAddModal);
  };

  // 渲染 series 网格项：图片、标题以及右键上下文菜单
  const renderSeriesGrid = () => {
    return searchResult.seriesList.map((series: Series) => {
      return (
        <div key={`${series.id}-${series.title}`} className="space-y-2">
          <ContextMenu>
            <ContextMenuTrigger>
              <div
                className="relative overflow-hidden cursor-pointer"
                onClick={() => handleOpenAddModal(series)}
              >
                <ExtensionImage
                  url={series.remoteCoverUrl}
                  series={series}
                  alt={series.title}
                  className={cn(
                    'hover:scale-105',
                    libraryCropCovers && 'aspect-[70/100]',
                    'h-auto w-full object-cover rounded-md transition-transform',
                  )}
                />
                <div
                  className="absolute bottom-0 left-0 right-0 p-2 flex items-end"
                  style={{
                    textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8), 0 0 10px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  <span className="line-clamp-3 text-white text-xs font-bold">{series.title}</span>
                </div>
              </div>
            </ContextMenuTrigger>
            <SearchGridContextMenu series={series} viewDetails={() => handleOpenAddModal(series)} />
          </ContextMenu>
        </div>
      );
    });
  };

  // 渲染加载时的骨架屏，数量根据当前列数调整
  const renderLoadingSkeleton = () => {
    const amount =
      {
        2: 4,
        4: 20,
        6: 24,
        8: 40,
      }[libraryColumns] || 8;

    return [...Array(amount).keys()].map((x) => (
      // aspect ratio of 7/10 -- (100/70 * 100)% ~= 142.857%
      <div key={`skeleton-${x}`} className="relative w-full pb-[142%]">
        <div className="absolute inset-0">
          <Skeleton className="h-full w-full rounded-md" />
        </div>
      </div>
    ));
  };

  // useEffect：监听滚动，当接近底部时触发 props.handleSearch() 用于加载更多（无限滚动）
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!searchResult.hasMore) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;

      const distanceFromBottom = scrollHeight - (clientHeight + scrollTop);
      const ratioOfVisibleHeight = distanceFromBottom / clientHeight;

      if (ratioOfVisibleHeight < 0.3) {
        // note: relying on handleSearch to debounce
        props.handleSearch();
      }
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [searchResult, props.handleSearch]);

  // useEffect：当列表较少无法填满视口时，自动触发一次加载以填充页面
  useEffect(() => {
    if (!searchResult.hasMore) return;
    const viewport = viewportRef.current;
    if (!viewport || !viewport.firstElementChild) return;

    if (viewport.firstElementChild.clientHeight < viewport.clientHeight) {
      props.handleSearch();
    }
  }, [props.loading]);

  return (
    <>
      <ScrollArea viewportRef={viewportRef} className="h-[calc(100vh-20px-64px)] w-full pr-4 -mr-2">
        <div
          className={cn(
            libraryColumns === 2 && 'grid-cols-2',
            libraryColumns === 4 && 'grid-cols-4',
            libraryColumns === 6 && 'grid-cols-6',
            libraryColumns === 8 && 'grid-cols-8',
            `grid gap-2`,
          )}
        >
          {renderSeriesGrid()}
          {props.loading ? renderLoadingSkeleton() : ''}
        </div>
      </ScrollArea>
    </>
  );
};

export default SearchGrid;
