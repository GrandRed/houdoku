const fs = require('fs');
const { ipcRenderer } = require('electron');
import { Chapter, LanguageKey, Series } from '@tiyo/common';
import { toast } from '@houdoku/ui/hooks/use-toast';
import { downloadCover } from '@/renderer/util/download';
import { FS_METADATA } from '@/common/temp_fs_metadata';
import ipcChannels from '@/common/constants/ipcChannels.json';
import library from '@/renderer/services/library';
import { getNumberUnreadChapters } from '@/renderer/util/comparison';
import routes from '@/common/constants/routes.json';

// 工具模块说明：
// 本文件包含与 Series/Chapter 导入、更新、删除和跳转相关的常用函数。
// - importSeries: 将 Series 和其章节从扩展/远程源抓取并写入本地库（library service）
// - reloadSeries / reloadSeriesList: 用于刷新已有库中 series 的元数据与章节
// - getFromChapterIds / migrateSeriesTags: 辅助性数据转换/迁移函数
// 这些函数会与主进程通过 ipcRenderer 通信，并使用 library 服务读写持久化数据。

const updateSeriesNumberUnread = (series: Series, chapterLanguages: LanguageKey[]) => {
  // 根据传入的语言过滤条件计算该 series 的未读章节数并写回数据库
  if (series.id !== undefined) {
    const chapters: Chapter[] = library.fetchChapters(series.id);
    library.upsertSeries({
      ...series,
      numberUnread: getNumberUnreadChapters(
        chapters.filter(
          (chapter) =>
            chapterLanguages.includes(chapter.languageKey) || chapterLanguages.length === 0,
        ),
      ),
    });
  }
};

// 从本地库加载指定 series 并通过回调设置（用于页面初始化/导航等）
export function loadSeries(seriesId: string, setSeries: (series: Series) => void) {
  const series: Series | null = library.fetchSeries(seriesId);
  if (series !== null) {
    setSeries(series);
  }
}

// 从本地库加载指定 series 的章节列表并通过回调设置
export function loadChapterList(
  seriesId: string,
  setChapterList: (chapterList: Chapter[]) => void,
) {
  const chapters: Chapter[] = library.fetchChapters(seriesId);
  setChapterList(chapters);
}

// 从本地库中删除 series，并清理对应的缩略图缓存，最后刷新传入的 series 列表
export function removeSeries(series: Series, setSeriesList: (seriesList: Series[]) => void) {
  if (series.id === undefined) return;

  library.removeSeries(series.id);
  ipcRenderer.invoke(ipcChannels.FILESYSTEM.DELETE_THUMBNAIL, series);
  setSeriesList(library.fetchSeriesList());
}

/**
 * importSeries
 *
 * 将指定的 series 导入到本地库：
 * - 如果不是 preview，则显示 toast 提示
 * - 可选地通过 getFirst 参数先从扩展完整获取 series 详情（包含更多字段）
 * - 拉取章节列表后写入数据库（library.upsertSeries / upsertChapters）
 * - 更新未读计数并在成功/失败时更新 toast
 *
 * 返回：导入后本地保存的 Series（包含数据库分配的 id）
 */
export async function importSeries(
  series: Series,
  chapterLanguages: LanguageKey[],
  getFirst = false,
): Promise<Series> {
  // console.info(`utils-importSeries--1 开始导入 ${series.title} 图片地址 ${series.remoteCoverUrl}`);

  let update: ReturnType<typeof toast>['update'] = () => false;
  if (!series.preview) {
    const toastResp = toast({
      title: 'Adding series to your library...',
      description: `Adding ${series.title}`,
      duration: 900000,
    });
    update = toastResp.update;
  }

  let seriesToAdd = series;
  let chapters: Chapter[] = [];
  try {
    // 注意这里如果是false 无法被正常添加到首页库中
    if (getFirst) {
      // 可选：先从扩展获取最新的 series 详情
      seriesToAdd = await ipcRenderer.invoke(
        ipcChannels.EXTENSION.GET_SERIES,
        series.extensionId,
        series.sourceId,
      );
    }
    // 拉取章节列表（扩展实现）
    chapters = await ipcRenderer.invoke(
      ipcChannels.EXTENSION.GET_CHAPTERS,
      seriesToAdd.extensionId,
      seriesToAdd.sourceId,
    );
    // console.info(`utils-importSeries--2 获取章节--Fetched ${chapters.length} chapters for series ${seriesToAdd.sourceId}`);
  } catch (error) {
    update({
      title: 'Failed to add series',
      description: 'An error occurred while adding the series to your library.',
    });

    throw error;
  }
  // 恢复原始数据中的数据
  seriesToAdd.remoteCoverUrl = series.remoteCoverUrl;
  seriesToAdd.categories = series.categories || [];

  // 写入 series（如果有 id，会保留，以便覆盖预览等情况），然后写入章节
  const addedSeries = library.upsertSeries({
    ...seriesToAdd,
    id: series.id,
  });
  // console.info(`utils-importSeries--3 写入图库信息--Written series ${addedSeries.sourceId} with database ID ${addedSeries.id}`);
  // chapters 文件夹名称自然排序
  const sortedChapters = [...chapters].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }),
  );
  library.upsertChapters(sortedChapters, addedSeries);
  updateSeriesNumberUnread(addedSeries, chapterLanguages);

  // console.info(`utils-importSeries--4 导入结束--Imported series ${addedSeries.sourceId} with database ID ${addedSeries.id}`);
  if (!series.preview) {
    update({ title: 'Added series', description: `Added ${addedSeries.title}`, duration: 5000 });
  }
  console.info(`utils-importSeries--5 导入完成--Import of series complete.`, addedSeries);
  return addedSeries;
}

// 标记章节已读/未读并更新本地章节与 Series 的未读计数
export function markChapters(
  chapters: Chapter[],
  series: Series,
  read: boolean,
  setChapterList: (chapterList: Chapter[]) => void,
  setSeries: (series: Series) => void,
  chapterLanguages: LanguageKey[],
) {
  if (series.id !== undefined) {
    const newChapters = chapters.map((chapter) => ({ ...chapter, read }));
    library.upsertChapters(newChapters, series);
    updateSeriesNumberUnread(series, chapterLanguages);
    loadChapterList(series.id, setChapterList);
    loadSeries(series.id, setSeries);
  }
}

async function reloadSeries(
  series: Series,
  chapterLanguages: LanguageKey[],
): Promise<Error | void> {
  // 刷新单个 series 的流程：
  // 1. 检查 series 是否有数据库 id，检查扩展是否存在
  // 2. 从扩展获取最新的 series 与 chapters
  // 3. 处理文件系统类型的 series（FS_METADATA）保持本地字段
  // 4. 对章节进行匹配以保留已有的 id 与已读状态，并删除孤立章节
  // 5. 写回数据库并更新封面缩略图（如果有变化）
  console.info(`Reloading series ${series.id} - ${series.title}`);
  if (series.id === undefined) {
    return new Promise((resolve) => resolve(Error('Series does not have database ID')));
  }

  if (
    (await ipcRenderer.invoke(ipcChannels.EXTENSION_MANAGER.GET, series.extensionId)) === undefined
  ) {
    return new Promise((resolve) => resolve(Error('Could not retrieve extension data')));
  }

  let newSeries: Series | undefined = await ipcRenderer.invoke(
    ipcChannels.EXTENSION.GET_SERIES,
    series.extensionId,
    series.sourceId,
  );
  if (newSeries === undefined)
    return new Promise((resolve) => resolve(Error('Could not get series from extension')));

  const newChapters: Chapter[] = await ipcRenderer.invoke(
    ipcChannels.EXTENSION.GET_CHAPTERS,
    series.extensionId,
    series.sourceId,
  );

  // 文件系统类型的 series 不使用扩展返回的元数据（保留本地数据）
  if (series.extensionId === FS_METADATA.id) {
    newSeries = { ...series };
  } else {
    newSeries.id = series.id;
    newSeries.trackerKeys = series.trackerKeys;
    newSeries.categories = series.categories;
  }

  // 合并章节：保持已有章节的 id 和已读状态，标记需要删除的章节
  const oldChapters: Chapter[] = library.fetchChapters(series.id);
  const orphanedChapterIds: string[] = oldChapters.map((chapter: Chapter) => chapter.id || '');

  const chapters: Chapter[] = newChapters.map((chapter: Chapter) => {
    const matchingChapter: Chapter | undefined = oldChapters.find(
      (c: Chapter) => c.sourceId === chapter.sourceId,
    );
    if (matchingChapter !== undefined && matchingChapter.id !== undefined) {
      chapter.id = matchingChapter.id;
      chapter.read = matchingChapter.read;

      orphanedChapterIds.splice(orphanedChapterIds.indexOf(matchingChapter.id), 1);
    }
    return chapter;
  });

  library.upsertSeries(newSeries);
  library.upsertChapters(chapters, newSeries);
  if (orphanedChapterIds.length > 0 && newSeries.id !== undefined) {
    library.removeChapters(orphanedChapterIds, newSeries.id);
  }

  updateSeriesNumberUnread(newSeries, chapterLanguages);

  // download the cover as a thumbnail if the remote URL has changed or
  // there is no existing thumbnail
  const thumbnailPath = await ipcRenderer.invoke(ipcChannels.FILESYSTEM.GET_THUMBNAIL_PATH, series);
  if (thumbnailPath !== null) {
    if (newSeries.remoteCoverUrl !== series.remoteCoverUrl || !fs.existsSync(thumbnailPath)) {
      console.debug(`Updating cover for series ${newSeries.id}`);
      ipcRenderer.invoke(ipcChannels.FILESYSTEM.DELETE_THUMBNAIL, series);
      downloadCover(newSeries);
    }
  }
}

export async function reloadSeriesList(
  seriesList: Series[],
  setSeriesList: (seriesList: Series[]) => void,
  setReloadingSeriesList: (reloadingSeriesList: boolean) => void,
  chapterLanguages: LanguageKey[],
) {
  // 批量刷新一组 series，显示进度 toast 并逐项调用 reloadSeries
  console.debug(`Reloading series list...`);
  setReloadingSeriesList(true);

  const { update } = toast!({
    title: 'Refreshing library...',
    duration: 900000,
  });

  const sortedSeriesList = [...seriesList].sort((a: Series, b: Series) =>
    a.title.localeCompare(b.title),
  );

  let cur = 0;
  const failedToUpdate: Series[] = [];

  for (const series of sortedSeriesList) {
    update({ description: `Reloading series ${cur}/${sortedSeriesList.length}` });

    const ret = await reloadSeries(series, chapterLanguages);
    if (ret instanceof Error) {
      console.error(ret);
      failedToUpdate.push(series);
    }
    cur += 1;
  }

  setSeriesList(library.fetchSeriesList());
  if (cur === 1 && failedToUpdate.length > 0) {
    update({
      title: 'Library refresh failed',
      description: `Error while reloading series "${seriesList[0].title}"`,
      duration: 5000,
    });
  } else if (failedToUpdate.length > 0) {
    update({
      title: 'Library refreshed with errors',
      description: `Failed to update ${failedToUpdate.length} series`,
    });
  } else {
    update({ title: 'Library refreshed', description: `Reloaded ${cur} series`, duration: 5000 });
  }

  setReloadingSeriesList(false);
}

// 更新 series 元数据并下载封面（若需要）
export function updateSeries(series: Series) {
  const newSeries = library.upsertSeries(series);
  return downloadCover(newSeries);
}

// 更新 series 的 tracker 键并写回数据库
export function updateSeriesTrackerKeys(
  series: Series,
  trackerKeys: { [trackerId: string]: string } | undefined,
) {
  return library.upsertSeries({ ...series, trackerKeys });
}

/**
 * Get a list of Series and associated Chapters from a list of chapterIds.
 * @param chapterIds list of Chapter UUIDs
 * @returns An object with two properties:
 *  - seriesList: Series[]
 *  - chapterLists: object with keys as `seriesId`s and values as Chapter[]
 *
 * 说明：根据章节 id 映射到对应的 series，并收集每个 series 下匹配的章节列表，返回用于批量操作（例如导出/下载）
 */
export function getFromChapterIds(chapterIds: string[]): {
  seriesList: Series[];
  chapterLists: { [seriesId: string]: Chapter[] };
} {
  const seriesSet = new Set<Series>();
  const chapterLists: { [seriesId: string]: Chapter[] } = {};

  library.fetchSeriesList().forEach((series) => {
    if (!series.id) return;

    library
      .fetchChapters(series.id)
      .filter((c) => c.id && chapterIds.includes(c.id))
      .forEach((chapter) => {
        if (!series.id) return;

        seriesSet.add(series);
        if (series.id in chapterLists) {
          chapterLists[series.id] = [...chapterLists[series.id], chapter];
        } else {
          chapterLists[series.id] = [chapter];
        }
      });
  });

  return {
    seriesList: Array.from(seriesSet),
    chapterLists,
  };
}

// 将旧的字段（formats/genres/...）合并迁移到新的 tags 字段中（一次性迁移工具）
export function migrateSeriesTags() {
  const seriesList: Series[] = library.fetchSeriesList();
  seriesList.forEach((series) => {
    const tags: string[] = [];
    ['formats', 'genres', 'demographics', 'contentWarnings', 'themes', 'tagKeys'].forEach(
      (oldField) => {
        if (oldField in series) {
          // @ts-expect-error handling deprecated key
          tags.push(...series[oldField]);
          // @ts-expect-error handling deprecated key
          delete series[oldField];

          library.upsertSeries({ ...series, tags });
        }
      },
    );
  });
}

// 导航到指定 series 的详情页（会检查扩展是否仍然可用并显示 toast）
export async function goToSeries(series: Series, navigate: (location: string) => void) {
  if (series.id !== undefined) {
    if (
      (await ipcRenderer.invoke(ipcChannels.EXTENSION_MANAGER.GET, series.extensionId)) ===
      undefined
    ) {
      toast({
        title: 'Content source not found',
        description:
          'The content source for this series was not found. Please update your plugins.',
        duration: 5000,
      });
    } else {
      navigate(`${routes.SERIES}/${series.id}`);
    }
  }
}
