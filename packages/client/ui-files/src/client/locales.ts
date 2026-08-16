/** `files` namespace dictionaries (view tab label + panel strings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'files'

/** The files dictionary key set (the source of truth for both locales). */
export type FilesKey =
  | 'view.files'
  | 'panel.aria'
  | 'panel.empty'
  | 'panel.loading'
  | 'panel.root'
  | 'panel.up'
  | 'panel.refresh'
  | 'panel.upload'
  | 'panel.open'
  | 'panel.download'
  | 'panel.copyPath'
  | 'panel.copied'
  | 'panel.save'
  | 'panel.close'
  | 'panel.edit'
  | 'panel.truncated'
  | 'panel.saved'
  | 'panel.error'
  | 'panel.notText'
  | 'panel.tooLarge'
  | 'panel.uploaded'
  | 'panel.uploadError'
  | 'mention.truncated'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Files view tab label and panel strings. */
    'files': FilesKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<FilesKey, string> = {
  'view.files': '文件',
  'panel.aria': '文件面板',
  'panel.empty': '（空目录）',
  'panel.loading': '加载中…',
  'panel.root': '工作区根目录',
  'panel.up': '上一级',
  'panel.refresh': '刷新',
  'panel.upload': '上传',
  'panel.open': '打开',
  'panel.download': '下载',
  'panel.copyPath': '复制路径',
  'panel.copied': '已复制路径',
  'panel.save': '保存',
  'panel.close': '关闭',
  'panel.edit': '编辑',
  'panel.truncated': '文件超过查看上限，已显示开头部分；编辑已禁用，请下载后修改。',
  'panel.saved': '已保存',
  'panel.error': '操作失败',
  'panel.notText': '该文件不是文本，无法预览。',
  'panel.tooLarge': '文件超出大小限制。',
  'panel.uploaded': '上传成功',
  'mention.truncated': '列表过长，已截断',
  'panel.uploadError': '上传失败',
}

/** English dictionary. */
export const en: Record<FilesKey, string> = {
  'view.files': 'Files',
  'panel.aria': 'Files panel',
  'panel.empty': '(empty directory)',
  'panel.loading': 'Loading…',
  'panel.root': 'Workspace root',
  'panel.up': 'Up',
  'panel.refresh': 'Refresh',
  'panel.upload': 'Upload',
  'panel.open': 'Open',
  'panel.download': 'Download',
  'panel.copyPath': 'Copy path',
  'panel.copied': 'Path copied',
  'panel.save': 'Save',
  'panel.close': 'Close',
  'panel.edit': 'Edit',
  'panel.truncated': 'The file exceeds the view limit; only its beginning is shown. Editing is disabled — download and modify it instead.',
  'panel.saved': 'Saved',
  'panel.error': 'Operation failed',
  'panel.notText': 'This file is not text and cannot be previewed.',
  'panel.tooLarge': 'The file exceeds the size limit.',
  'panel.uploaded': 'Uploaded',
  'mention.truncated': 'Listing truncated',
  'panel.uploadError': 'Upload failed',
}
