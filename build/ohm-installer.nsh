; Ohm Studio by Nodaris – Setup-Assistent (Ergänzungen zum electron-builder-NSIS-Assistenten)
; Seiten: Willkommen → Lizenz → Installationsart (für mich / für alle) → Zielordner → Komponenten → Optionen → Installieren → Fertig
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
  Var OptExamples
  Var OptCourse
  Var OptEmu
  Var OptDesktop
  Var OptStartMenu
  Var OptAssoc
  Var OptUpdates
  Var hExamples
  Var hCourse
  Var hEmu
  Var hDesktop
  Var hStartMenu
  Var hAssoc
  Var hUpdates
!endif

!macro customHeader
  !define MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH
!macroend

!macro customInit
  ; Standardwerte (gelten auch für die stille Installation mit /S)
  StrCpy $OptExamples 1
  StrCpy $OptCourse 1
  StrCpy $OptEmu 0
  StrCpy $OptDesktop 1
  StrCpy $OptStartMenu 1
  StrCpy $OptAssoc 1
  StrCpy $OptUpdates 1
  ; Firmen-IT: /NOUPDATES schaltet automatische Updates ab, /NODESKTOP die Desktop-Verknüpfung
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/NOUPDATES" $R1
  ${IfNot} ${Errors}
    StrCpy $OptUpdates 0
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/NODESKTOP" $R1
  ${IfNot} ${Errors}
    StrCpy $OptDesktop 0
  ${EndIf}
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Willkommen bei Ohm Studio by Nodaris"
  !define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert Ohm Studio ${VERSION} auf deinem Computer.$\r$\n$\r$\nOhm Studio ist dein Elektronik-Labor: Schaltungen bauen, mit echtem Code simulieren, als Platine bestellen – oder einfach eine Idee beschreiben und Ohm Studio baut sie.$\r$\n$\r$\nKlicke auf „Weiter“, um fortzufahren."
  !insertmacro MUI_PAGE_WELCOME
  ; Lizenz mit Häkchen „Ich akzeptiere …“ statt Knopf „Annehmen“ (gilt für die direkt folgende Lizenzseite)
  !define MUI_LICENSEPAGE_CHECKBOX
  !define MUI_LICENSEPAGE_CHECKBOX_TEXT "Ich akzeptiere die Lizenzvereinbarung"
!macroend

!macro customPageAfterChangeDir
  Page custom OhmComponentsPage OhmComponentsLeave
  Page custom OhmOptionsPage OhmOptionsLeave
  ; Texte der Fertig-Seite (gelten für die nächste Fertig-Seite)
  !define MUI_FINISHPAGE_TITLE "Ohm Studio ist installiert"
  !define MUI_FINISHPAGE_TEXT "Ohm Studio by Nodaris wurde erfolgreich installiert.$\r$\n$\r$\nDu findest es im Startmenü und – falls gewählt – auf dem Desktop."
  !define MUI_FINISHPAGE_RUN_TEXT "Ohm Studio jetzt starten"

  Function OhmComponentsPage
    !insertmacro MUI_HEADER_TEXT "Komponenten" "Wähle aus, was installiert werden soll."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 20u "Das Programm selbst wird immer installiert. Die übrigen Teile kannst du hier an- oder abwählen:"
    Pop $0
    ${NSD_CreateCheckbox} 0 26u 100% 12u "Ohm Studio (Programm, erforderlich)"
    Pop $0
    ${NSD_Check} $0
    EnableWindow $0 0
    ${NSD_CreateCheckbox} 0 42u 100% 12u "Beispielprojekte (10 Projekte in „Dokumente\Ohm Studio\Beispiele“)"
    Pop $hExamples
    ${NSD_SetState} $hExamples $OptExamples
    ${NSD_CreateCheckbox} 0 58u 100% 12u "Kurs „Elektronik in 30 Lektionen“ (im Menü Hilfe)"
    Pop $hCourse
    ${NSD_SetState} $hCourse $OptCourse
    ${NSD_CreateCheckbox} 0 74u 100% 12u "Sprachpakete: Deutsch, Englisch und 8 weitere Sprachen (immer enthalten)"
    Pop $0
    ${NSD_Check} $0
    EnableWindow $0 0
    ${NSD_CreateCheckbox} 0 90u 100% 12u "ESP32-Emulator (Espressif QEMU, ca. 70 MB, wird beim ersten Gebrauch geladen)"
    Pop $hEmu
    ${NSD_SetState} $hEmu $OptEmu
    nsDialogs::Show
  FunctionEnd

  Function OhmComponentsLeave
    ${NSD_GetState} $hExamples $OptExamples
    ${NSD_GetState} $hCourse $OptCourse
    ${NSD_GetState} $hEmu $OptEmu
  FunctionEnd

  Function OhmOptionsPage
    !insertmacro MUI_HEADER_TEXT "Optionen" "Verknüpfungen und Updates einstellen."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateCheckbox} 0 0 100% 12u "Verknüpfung auf dem Desktop anlegen"
    Pop $hDesktop
    ${NSD_SetState} $hDesktop $OptDesktop
    ${NSD_CreateCheckbox} 0 16u 100% 12u "Eintrag im Startmenü anlegen"
    Pop $hStartMenu
    ${NSD_SetState} $hStartMenu $OptStartMenu
    ${NSD_CreateCheckbox} 0 32u 100% 12u ".ohm-Dateien mit Ohm Studio öffnen"
    Pop $hAssoc
    ${NSD_SetState} $hAssoc $OptAssoc
    ${NSD_CreateCheckbox} 0 48u 100% 12u "Automatisch nach Updates suchen (übertragen wird nur die Versionsnummer)"
    Pop $hUpdates
    ${NSD_SetState} $hUpdates $OptUpdates
    nsDialogs::Show
  FunctionEnd

  Function OhmOptionsLeave
    ${NSD_GetState} $hDesktop $OptDesktop
    ${NSD_GetState} $hStartMenu $OptStartMenu
    ${NSD_GetState} $hAssoc $OptAssoc
    ${NSD_GetState} $hUpdates $OptUpdates
  FunctionEnd
!macroend

!macro ohmBool VAR OUT
  ${If} ${VAR} == 1
    StrCpy ${OUT} "true"
  ${Else}
    StrCpy ${OUT} "false"
  ${EndIf}
!macroend

!macro customInstall
  ; Auswahl für das Programm festhalten
  !insertmacro ohmBool $OptExamples $R1
  !insertmacro ohmBool $OptCourse $R2
  !insertmacro ohmBool $OptEmu $R3
  !insertmacro ohmBool $OptUpdates $R4
  FileOpen $0 "$INSTDIR\install.json" w
  FileWrite $0 '{"examples":$R1,"course":$R2,"emulator":$R3,"autoUpdate":$R4,"mode":"$installMode","version":"${VERSION}"}'
  FileClose $0

  ; Verknüpfungen
  ${If} $OptDesktop == 1
    CreateShortCut "$DESKTOP\Ohm Studio.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "Ohm Studio by Nodaris"
  ${EndIf}
  ${If} $OptStartMenu == 1
    CreateShortCut "$SMPROGRAMS\Ohm Studio.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "Ohm Studio by Nodaris"
    WinShell::SetLnkAUMI "$SMPROGRAMS\Ohm Studio.lnk" "com.nodaris.ohmstudio"
  ${EndIf}

  ; .ohm-Dateien verknüpfen (für mich: HKCU, für alle: HKLM – SHCTX folgt der Installationsart)
  ${If} $OptAssoc == 1
    WriteRegStr SHCTX "Software\Classes\.ohm" "" "NodarisOhmStudio.Projekt"
    WriteRegStr SHCTX "Software\Classes\.ohm" "Content Type" "application/x-ohm"
    WriteRegStr SHCTX "Software\Classes\NodarisOhmStudio.Projekt" "" "Ohm-Studio-Projekt"
    WriteRegStr SHCTX "Software\Classes\NodarisOhmStudio.Projekt\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
    WriteRegStr SHCTX "Software\Classes\NodarisOhmStudio.Projekt\shell\open" "" "Mit Ohm Studio öffnen"
    WriteRegStr SHCTX "Software\Classes\NodarisOhmStudio.Projekt\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}

  ; Beispielprojekte in die eigenen Dokumente kopieren (nie vorhandene Dateien überschreiben)
  ${If} $OptExamples == 1
    SetShellVarContext current
    CreateDirectory "$DOCUMENTS\Ohm Studio\Beispiele"
    SetOverwrite off
    CopyFiles /SILENT "$INSTDIR\resources\examples\*.ohm" "$DOCUMENTS\Ohm Studio\Beispiele"
    SetOverwrite on
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Ohm Studio.lnk"
  Delete "$SMPROGRAMS\Ohm Studio.lnk"
  ReadRegStr $R0 SHCTX "Software\Classes\.ohm" ""
  ${If} $R0 == "NodarisOhmStudio.Projekt"
    DeleteRegKey SHCTX "Software\Classes\.ohm"
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\NodarisOhmStudio.Projekt"
  ; Link-Protokoll ohmstudio:// (legt das Programm beim ersten Start für den Benutzer an)
  ${IfNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\ohmstudio"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  Delete "$INSTDIR\install.json"

  ; Bei einem Update nichts fragen; still deinstallieren behält immer alles
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "Möchtest du deine Einstellungen, die automatische Sicherung und die Beispielprojekte behalten?$\r$\n$\r$\nDeine eigenen .ohm-Projektdateien werden in keinem Fall gelöscht." /SD IDYES IDYES ohmKeep
      SetShellVarContext current
      RMDir /r "$APPDATA\Ohm Studio"
      RMDir /r "$DOCUMENTS\Ohm Studio\Beispiele"
      RMDir "$DOCUMENTS\Ohm Studio"
    ohmKeep:
  ${EndIf}
!macroend
