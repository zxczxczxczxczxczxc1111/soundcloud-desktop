; Ссылки soundcloud-desktop:// клиент регистрирует сам при запуске (app.setAsDefaultProtocolClient, ключ в HKCU).
; При удалении запись убирается, при обновлении остаётся: новая версия лежит по тому же пути и запишет её снова.
; Деинсталлятор пишет ставящаяся версия, поэтому снятие сработает при удалении версий, вышедших после этой
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\soundcloud-desktop"
  ${endIf}
!macroend
