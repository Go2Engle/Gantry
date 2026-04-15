# Changelog

## [0.10.4](https://github.com/Go2Engle/Gantry/compare/v0.10.3...v0.10.4) (2026-04-15)


### Bug Fixes

* Unhide refactor section in release config ([#62](https://github.com/Go2Engle/Gantry/issues/62)) ([76740eb](https://github.com/Go2Engle/Gantry/commit/76740eb6fa61d0a44b5a446a0f06dc946a0ddcb5))


### Code Refactoring

* **topology:** improve dependency handling for nested entities ([#61](https://github.com/Go2Engle/Gantry/issues/61)) ([d08bb29](https://github.com/Go2Engle/Gantry/commit/d08bb298e1b5cbae4ab651460d71aa12ecfbd7ed))

## [0.10.3](https://github.com/Go2Engle/Gantry/compare/v0.10.2...v0.10.3) (2026-04-15)


### Features

* topology upgrades ([#59](https://github.com/Go2Engle/Gantry/issues/59)) ([519ce3d](https://github.com/Go2Engle/Gantry/commit/519ce3d7b264b99e5a84323e8931dd295f4d3091))

## [0.10.2](https://github.com/Go2Engle/Gantry/compare/v0.10.1...v0.10.2) (2026-04-15)


### Bug Fixes

* **kubernetes:** track touched entities during sync for GitOps integration ([#56](https://github.com/Go2Engle/Gantry/issues/56)) ([241d1b2](https://github.com/Go2Engle/Gantry/commit/241d1b20961f7ae68a797d67fe9fa58de23e44bb))

## [0.10.1](https://github.com/Go2Engle/Gantry/compare/v0.10.0...v0.10.1) (2026-04-15)


### Bug Fixes

* **kubernetes:** link Infrastructure to Service entities in sync process ([#54](https://github.com/Go2Engle/Gantry/issues/54)) ([2552321](https://github.com/Go2Engle/Gantry/commit/255232133723c8e1630ca8a445ed31ddf66853dc))

## [0.10.0](https://github.com/Go2Engle/Gantry/compare/v0.9.1...v0.10.0) (2026-04-14)


### Features

* add Harbor sidebar toggle ([#47](https://github.com/Go2Engle/Gantry/issues/47)) ([3f4a52c](https://github.com/Go2Engle/Gantry/commit/3f4a52c7337637b4f01b8efa80adda48dad57063))
* add Nexus Repository Manager explorer ([#52](https://github.com/Go2Engle/Gantry/issues/52)) ([d0f70d6](https://github.com/Go2Engle/Gantry/commit/d0f70d6e9d1533fb6a64269d0dbcba549acd40b3))
* **docs:** add local search to docs site ([#50](https://github.com/Go2Engle/Gantry/issues/50)) ([3544e60](https://github.com/Go2Engle/Gantry/commit/3544e607b63c0efb18abf48f2373dbf9919dba8a))

## [0.9.1](https://github.com/Go2Engle/Gantry/compare/v0.9.0...v0.9.1) (2026-04-07)


### Bug Fixes

* **auth:** redirect to login screen on session expiry ([#44](https://github.com/Go2Engle/Gantry/issues/44)) ([bb92628](https://github.com/Go2Engle/Gantry/commit/bb92628196b180f1b04264ebdf4ef2ef1df4c9a5))

## [0.9.0](https://github.com/Go2Engle/Gantry/compare/v0.8.0...v0.9.0) (2026-03-31)


### Features

* add APIs tab to Service entity detail view ([#41](https://github.com/Go2Engle/Gantry/issues/41)) ([d25b23b](https://github.com/Go2Engle/Gantry/commit/d25b23b4a2cd04256420542aa84b11628a0926bc))

## [0.8.0](https://github.com/Go2Engle/Gantry/compare/v0.7.0...v0.8.0) (2026-03-30)


### Features

* **actions:** add entity list dropdown for select fields ([#37](https://github.com/Go2Engle/Gantry/issues/37)) ([3a301a0](https://github.com/Go2Engle/Gantry/commit/3a301a002c5bdc9573dd752d77e84bf9e160c8fb))


### Bug Fixes

* **StatusMonitor:** prevent operational and unknown statuses from showing in issues filter ([#35](https://github.com/Go2Engle/Gantry/issues/35)) ([3dd2a0d](https://github.com/Go2Engle/Gantry/commit/3dd2a0d53a77de610d49115c5c429f8c56c11900))

## [0.7.0](https://github.com/Go2Engle/Gantry/compare/v0.6.0...v0.7.0) (2026-03-18)


### Features

* add Harbor plugin integration ([#21](https://github.com/Go2Engle/Gantry/issues/21)) ([4092d52](https://github.com/Go2Engle/Gantry/commit/4092d523cb8627429a1b7cbb96dcebb645b499e5))
* add Nexus Repository Manager plugin integration with components and assets endpoints ([#24](https://github.com/Go2Engle/Gantry/issues/24)) ([28ce025](https://github.com/Go2Engle/Gantry/commit/28ce025abfd6b369261b79d64539156d35d95db2))


### Bug Fixes

* update HealthCheckProxy test to allow internal and private IPs ([#23](https://github.com/Go2Engle/Gantry/issues/23)) ([85d73c4](https://github.com/Go2Engle/Gantry/commit/85d73c4b5d1b0d30705c9f623117918eb212c831))

## [0.6.0](https://github.com/Go2Engle/Gantry/compare/v0.5.0...v0.6.0) (2026-03-17)


### Features

* add ListView component for entity relationships and toggle betw… ([#20](https://github.com/Go2Engle/Gantry/issues/20)) ([860e6ba](https://github.com/Go2Engle/Gantry/commit/860e6ba79ac185a2d7e271e683dd5217892aa607))
* add SSO-only user support and password reset functionality ([#18](https://github.com/Go2Engle/Gantry/issues/18)) ([39be33d](https://github.com/Go2Engle/Gantry/commit/39be33d22323b78baeabb29eedd8f7a7eaaee3cd))
* implement bidirectional sync and file content retrieval for GitOps ([c4db1f7](https://github.com/Go2Engle/Gantry/commit/c4db1f7ace6b53518b7965f1b6a81949a625a959))


### Bug Fixes

* enhance ActionWizard with role-based permissions and slug auto-generation ([#15](https://github.com/Go2Engle/Gantry/issues/15)) ([4df1cdd](https://github.com/Go2Engle/Gantry/commit/4df1cddc367e9ff921902d14556afb75df699e84))

## [0.5.0](https://github.com/Go2Engle/Gantry/compare/v0.4.0...v0.5.0) (2026-03-16)


### Features

* add version display in API and UI components ([#13](https://github.com/Go2Engle/Gantry/issues/13)) ([7cd7765](https://github.com/Go2Engle/Gantry/commit/7cd7765b344509832ef75616f126fe0f6b6b6630))

## [0.4.0](https://github.com/Go2Engle/Gantry/compare/v0.3.0...v0.4.0) (2026-03-16)


### Features

* add install script for Gantry with checksum verification and OS detection ([54ff87a](https://github.com/Go2Engle/Gantry/commit/54ff87adb536b35f29a4d434eda451a402022cb9))
* add logo images and update branding in various components ([#12](https://github.com/Go2Engle/Gantry/issues/12)) ([2c98ff0](https://github.com/Go2Engle/Gantry/commit/2c98ff0967b00b44ac5c6ad35c19428f9c5c78f7))
* implement required field validation and error handling in forms ([#10](https://github.com/Go2Engle/Gantry/issues/10)) ([e995387](https://github.com/Go2Engle/Gantry/commit/e995387d11a1210c50ba21bad9eaaadbc61d44b4))


### Bug Fixes

* enhance version display in upgrade process and add unit tests fo… ([#11](https://github.com/Go2Engle/Gantry/issues/11)) ([a29f54a](https://github.com/Go2Engle/Gantry/commit/a29f54afe01a6e93999af48e2f18dbfb0a1ef384))

## [0.3.0](https://github.com/Go2Engle/Gantry/compare/v0.2.0...v0.3.0) (2026-03-16)


### Features

* add Microsoft Teams Notifications plugin for action lifecycle updates ([#5](https://github.com/Go2Engle/Gantry/issues/5)) ([c3adc5c](https://github.com/Go2Engle/Gantry/commit/c3adc5c0adf7e06aea3d6e6d32d2161fe0aee57f))
* Ganty install/update/uninstall command ([#6](https://github.com/Go2Engle/Gantry/issues/6)) ([d8aef27](https://github.com/Go2Engle/Gantry/commit/d8aef27c6f90456b48827d0233377ccbae44ba8f))

## [0.2.0](https://github.com/Go2Engle/Gantry/compare/v0.1.0...v0.2.0) (2026-03-13)


### Features

* add loading skeleton for status monitor widget in dashboard ([#2](https://github.com/Go2Engle/Gantry/issues/2)) ([33b0274](https://github.com/Go2Engle/Gantry/commit/33b02746f109148fea746bb7f55ab78428e05c22))
* enhance API key creation to prevent privilege escalation and add WebSocket authentication support ([97ba172](https://github.com/Go2Engle/Gantry/commit/97ba1724a84af42576b67954cff5fdc3c44e4b91))
* enhance PullResult structure with error details and improve error handling in GitOps ([40cbd10](https://github.com/Go2Engle/Gantry/commit/40cbd106ffa990cc63401cd67b0e7d780ea321b7))
* implement session-based authentication and logout functionality, enhance plugin config handling, and improve health check proxy security ([7a9ab48](https://github.com/Go2Engle/Gantry/commit/7a9ab48a7efc072525b9589aea695d992f44735e))
* restore and enable website deployment workflow in GitHub Actions ([9aedd9c](https://github.com/Go2Engle/Gantry/commit/9aedd9cb3390feaee4ebd1048cf2dcd2cd7152ba))
* update documentation for authentication, API endpoints, and plugin configurations; enhance user guidance and clarify roles ([f37e2a6](https://github.com/Go2Engle/Gantry/commit/f37e2a612978551d980c27d6b123c48e1e316e2a))
