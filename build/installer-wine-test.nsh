; NUR für automatische Tests unter Wine: die Prüfung „Programm läuft noch“ nutzt PowerShell/tasklist,
; die unter Wine falsch antworten. Im echten Setup bleibt die Standardprüfung aktiv.
!macro customCheckAppRunning
!macroend
!include "${BUILD_RESOURCES_DIR}\ohm-installer.nsh"
