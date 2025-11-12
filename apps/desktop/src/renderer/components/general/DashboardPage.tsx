import React, { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import SeriesDetails from '../library/SeriesDetails';
import Search from '../search/Search';
import routes from '@/common/constants/routes.json';
import { importSeries, reloadSeriesList } from '@/renderer/features/library/utils';
import Library from '../library/Library';
import Plugins from '../plugins/Plugins';
import Downloads from '../downloads/Downloads';
import {
  activeSeriesListState,
  completedStartReloadState,
  importingState,
  importQueueState,
  reloadingSeriesListState,
  seriesListState,
} from '@/renderer/state/libraryStates';
import library from '@/renderer/services/library';
import {
  autoBackupCountState,
  autoBackupState,
  chapterLanguagesState,
  refreshOnStartState,
} from '@/renderer/state/settingStates';
import { downloadCover } from '@/renderer/util/download';
import { createAutoBackup } from '@/renderer/util/backup';
import { SidebarProvider } from '@houdoku/ui/components/Sidebar';
import { DashboardSidebar } from './DashboardSidebar';

interface Props {}

/**
 * DashboardPage 组件
 *
 * 负责：
 * - 提供应用主布局（侧边栏 + 内容区）
 * - 挂载时处理自动备份与启动时刷新库的逻辑
 * - 作为 importQueue 的消费者：从 importQueue 中取出任务并调用 importSeries 将 series 导入本地库
 *
 * 说明：
 * - importQueueState 保存要导入的任务队列（由搜索/导入界面等放入）
 * - importingState 表示当前是否正在执行导入任务（用来串行化 importQueue）
 */
const DashboardPage: React.FC<Props> = () => {
  // 用于在导入完成后刷新 UI（将数据库中的 series 列表写回 recoil）
  const setSeriesList = useSetRecoilState(seriesListState);

  // 计算得到的“活跃”series 列表（selector），用于判断是否需要在启动时刷新
  const activeSeriesList = useRecoilValue(activeSeriesListState);

  // 用于控制刷新库列表的 loading 状态（只在刷新时置 true）
  const [, setReloadingSeriesList] = useRecoilState(reloadingSeriesListState);

  // 标记：是否已完成应用启动过程中的一次自动刷新（避免重复触发）
  const [completedStartReload, setCompletedStartReload] = useRecoilState(completedStartReloadState);

  // 开关：启动时是否自动刷新库（来自设置）
  const refreshOnStart = useRecoilValue(refreshOnStartState);

  // 自动备份设置：是否开启及保留份数
  const autoBackup = useRecoilValue(autoBackupState);
  const autoBackupCount = useRecoilValue(autoBackupCountState);

  // 章节语言偏好（导入/刷新时用于计算未读）
  const chapterLanguages = useRecoilValue(chapterLanguagesState);

  // importQueue 与 importing：导入任务队列与当前导入中标志
  const [importQueue, setImportQueue] = useRecoilState(importQueueState);
  const [importing, setImporting] = useRecoilState(importingState);

  // 组件挂载或 activeSeriesList 变更时触发：处理自动备份与启动时刷新
  useEffect(() => {
    // 若开启自动备份则创建备份
    if (autoBackup) {
      createAutoBackup(autoBackupCount);
    }

    // 启动时若设置为刷新且尚未完成第一次刷新并且库不为空，则触发一次刷新
    if (refreshOnStart && !completedStartReload && activeSeriesList.length > 0) {
      setCompletedStartReload(true);
      // 从持久层读取当前库并批量刷新（reloadSeriesList 会内部处理进度与错误）
      reloadSeriesList(
        library.fetchSeriesList(),
        setSeriesList,
        setReloadingSeriesList,
        chapterLanguages,
      ).catch((e) => console.error(e));
    }
    // 依赖 activeSeriesList 保证在库内容可用后触发一次
  }, [activeSeriesList]);

  // importQueue 的消费逻辑：当没有正在导入且队列不为空时，取队首任务执行导入
  useEffect(() => {
    if (!importing && importQueue.length > 0) {
      // 标记正在导入，取出队首任务并从队列移除
      setImporting(true);
      const task = importQueue[0];
      setImportQueue(importQueue.slice(1));

      // 调用 importSeries 执行真实的导入（包括写库、插入章节等）
      importSeries(task.series, chapterLanguages, task.getFirst)
        .then((addedSeries) => {
          // 导入完成后刷新全局 series 列表并清除 importing 标志
          setSeriesList(library.fetchSeriesList());
          setImporting(false);

          // 若不是预览（preview），则下载封面缩略图以供展示
          if (!task.series.preview) downloadCover(addedSeries);
        })
        .catch((e) => {
          // 出错时打印并清理 importing 标志，队列中剩余任务仍会继续被处理
          console.error(e);
          setImporting(false);
        });
    }
    // 依赖 importQueue 与 importing，使得队列变化或导入状态变化都会重新评估消费逻辑
  }, [importQueue, importing]);

  return (
    // 应用侧边栏提供者：设置侧边栏宽度并渲染 DashboardSidebar 与路由内容
    <SidebarProvider
      style={
        {
          '--sidebar-width': '200px',
        } as React.CSSProperties
      }
    >
      <DashboardSidebar />
      <div className="px-2 w-full">
        <Routes>
          <Route path={`${routes.SERIES}/:id`} element={<SeriesDetails />} />
          <Route path={`${routes.SEARCH}/*`} element={<Search />} />
          <Route path={`${routes.PLUGINS}/*`} element={<Plugins />} />
          <Route path={`${routes.DOWNLOADS}/*`} element={<Downloads />} />
          <Route path="*" element={<Library />} />
        </Routes>
      </div>
    </SidebarProvider>
  );
};

export default DashboardPage;
