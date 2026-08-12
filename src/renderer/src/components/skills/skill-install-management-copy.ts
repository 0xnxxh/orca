import { translate } from '@/i18n/i18n'

export function skillInstallManagementCopy() {
  return {
    title: translate(
      'auto.components.skills.SkillInstallManagementDialog.44d118a8f7',
      'Manage installed skills'
    ),
    description: translate(
      'auto.components.skills.SkillInstallManagementDialog.3677ae58e7',
      'Update, roll back, or safely remove versions installed by Orca.'
    ),
    localMachine: translate(
      'auto.components.skills.SkillInstallManagementDialog.6cb1fbe039',
      'This computer'
    ),
    ssh: translate('auto.components.skills.SkillInstallManagementDialog.176fef9516', '· SSH'),
    disconnected: translate(
      'auto.components.skills.SkillInstallManagementDialog.0900db719a',
      '— disconnected'
    ),
    noInstalls: translate(
      'auto.components.skills.SkillInstallManagementDialog.64c71cf7b9',
      'No Orca-managed skill installs were found on this machine.'
    ),
    installedVersion: translate(
      'auto.components.skills.SkillInstallManagementDialog.9c04bd0120',
      'Installed version'
    ),
    chooseVersion: translate(
      'auto.components.skills.SkillInstallManagementDialog.86ed219b55',
      'Choose a version'
    ),
    modified: translate(
      'auto.components.skills.SkillInstallManagementDialog.74b70892ea',
      'Local files were modified'
    ),
    preserveModified: translate(
      'auto.components.skills.SkillInstallManagementDialog.070654c6d1',
      'Orca will preserve them unless you explicitly discard the local changes.'
    ),
    discardAndInstall: translate(
      'auto.components.skills.SkillInstallManagementDialog.e1884c812e',
      'Discard changes and install version'
    ),
    discardAndRemove: translate(
      'auto.components.skills.SkillInstallManagementDialog.f7c5075e77',
      'Discard changes and remove'
    ),
    retryCoverage: translate(
      'auto.components.skills.SkillInstallManagementDialog.2ae587d39c',
      'Retry incomplete coverage'
    ),
    installVersion: translate(
      'auto.components.skills.SkillInstallManagementDialog.561e49ccd1',
      'Install selected version'
    ),
    cancelInstall: translate(
      'auto.components.skills.SkillInstallManagementDialog.c1d03ee50d',
      'Cancel installation'
    ),
    confirmRemove: translate(
      'auto.components.skills.SkillInstallManagementDialog.470d8d2476',
      'Confirm remove'
    ),
    remove: translate('auto.components.skills.SkillInstallManagementDialog.e91af0079f', 'Remove'),
    installedBundleSkills: translate(
      'auto.components.skills.SkillInstallManagementDialog.1c9e7f420a',
      'Installed bundle skills'
    ),
    installSkills: (count: number) =>
      translate(
        'auto.components.skills.SkillInstallManagementDialog.34c2ef9e71',
        'Install {{count}} skills',
        { count }
      ),
    removeSkills: (count: number) =>
      translate(
        'auto.components.skills.SkillInstallManagementDialog.a0cab67c2f',
        'Remove {{count}} skills',
        { count }
      ),
    confirmRemoveSkills: (count: number) =>
      translate(
        'auto.components.skills.SkillInstallManagementDialog.f970d8088d',
        'Confirm remove {{count}} skills',
        { count }
      ),
    bundleResult: (installed: number, updated: number, keptLocal: number) =>
      translate(
        'auto.components.skills.SkillInstallManagementDialog.dab29e4b54',
        '{{installed}} installed · {{updated}} updated · {{keptLocal}} kept local',
        { installed, updated, keptLocal }
      ),
    close: translate('auto.components.skills.SkillInstallManagementDialog.8095927ff3', 'Close')
  }
}
