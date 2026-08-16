/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'document.title': '配置文件',
  'document.editorLabel': '配置文件内容',
  'document.save': '保存',
  'document.cancel': '取消',
  'document.saveError': '保存失败',
  'general.nav': '通用设置',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'document.title': 'Configuration file',
  'document.editorLabel': 'Configuration file content',
  'document.save': 'Save',
  'document.cancel': 'Cancel',
  'document.saveError': 'Save failed',
  'general.nav': 'General',
} satisfies Record<SettingsKey, string>
