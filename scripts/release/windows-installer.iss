#ifndef AppVersion
  #error AppVersion must be provided with /DAppVersion=x.y.z
#endif
#ifndef ReleaseRoot
  #error ReleaseRoot must be provided with /DReleaseRoot=path
#endif
#ifndef OutputDirectory
  #error OutputDirectory must be provided with /DOutputDirectory=path
#endif

#define AppName "OpenChatGPTSkin"
#define AppPublisher "OpenChatGPTSkin Contributors"
#define AppUrl "https://github.com/u2bo/OpenChatGPTSkin"

[Setup]
AppId={{A7E2825E-2E95-4AF1-B0B7-CC5D7482AF36}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
DefaultDirName={localappdata}\Programs\OpenChatGPTSkin
DefaultGroupName=OpenChatGPTSkin
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
OutputDir={#OutputDirectory}
OutputBaseFilename=OpenChatGPTSkin_{#AppVersion}_windows_x64_Setup
UninstallDisplayIcon={app}\OpenChatGPTSkin.cmd
CloseApplications=no
RestartApplications=no
SetupLogging=yes

[Files]
Source: "{#ReleaseRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\OpenChatGPTSkin"; Filename: "{app}\OpenChatGPTSkin.cmd"; WorkingDir: "{app}"
Name: "{group}\卸载 OpenChatGPTSkin"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\OpenChatGPTSkin.cmd"; Description: "启动 OpenChatGPTSkin"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataRoot: String;
begin
  if (CurUninstallStep <> usPostUninstall) or UninstallSilent then
    Exit;

  DataRoot := ExpandConstant('{localappdata}\OpenChatGPTSkin');
  if not DirExists(DataRoot) then
    Exit;

  if MsgBox(
    '是否同时删除个人主题、草稿、版本和 Runtime 状态？' + #13#10 + #13#10 +
    '此操作不可恢复。选择“否”将保留全部个人数据。',
    mbConfirmation,
    MB_YESNO or MB_DEFBUTTON2
  ) <> IDYES then
    Exit;

  if not DelTree(DataRoot, True, True, True) then
    MsgBox(
      '个人数据未能全部删除。请关闭 OpenChatGPTSkin 和 Codex 后，手动删除：' + #13#10 + DataRoot,
      mbError,
      MB_OK
    );
end;
