// 本文件由人工维护：基于 iTerm2 官方导出 JSON（Settings > Profiles > Save Profile as JSON）
// 与官方文档收录 Dynamic Profiles 支持的 profile 属性 key。
// 脚本 scripts/fetch-iterm2-keys.mjs 可抓取源码 ProfileModel.m 生成骨架补充。
export type RawIterm2KeyType = "bool" | "yesno" | "number" | "color" | "enum" | "text";

export interface RawIterm2Key {
  key: string;
  type: RawIterm2KeyType;
  enum?: readonly string[];
  min?: number;
  max?: number;
  placeholder?: string;
  description: string;
  zh: string;
  category: string;
  introduced?: string;
}

export const ITERM2_KEY_RAW: readonly RawIterm2Key[] = [
  // 基本信息
  {"key": "Name", "type": "text", "placeholder": "如 My Profile", "description": "The name of the profile. Required for every dynamic profile.", "zh": "配置名称（必填）", "category": "基本信息"},
  {"key": "Guid", "type": "text", "placeholder": "如 12345678-1234-1234-1234-123456789012", "description": "A globally unique identifier for the profile. Required. A dynamic profile whose Guid equals an existing regular profile's Guid is ignored.", "zh": "全局唯一标识（必填，建议 UUID）", "category": "基本信息"},
  {"key": "Dynamic Profile Parent Name", "type": "text", "placeholder": "父配置名称", "description": "Name of a profile to inherit unspecified attributes from. Falls back to the default profile when not found.", "zh": "父配置名称（未指定的属性从此配置继承）", "category": "基本信息"},
  {"key": "Dynamic Profile Parent Guid", "type": "text", "placeholder": "父配置 GUID", "description": "Another way to specify a parent. Takes precedence over Dynamic Profile Parent Name. Available since 3.4.9.", "zh": "父配置 GUID（3.4.9+，优先于父配置名称）", "category": "基本信息", "introduced": "3.4.9"},
  {"key": "Rewritable", "type": "bool", "description": "If true, iTerm2 may rewrite the file on disk to reflect changes made in the settings UI.", "zh": "允许 iTerm2 在设置界面修改后回写此文件", "category": "基本信息"},
  {"key": "Tags", "type": "text", "description": "An array of tags applied to the profile. Complex values are shown read-only in the form.", "zh": "标签（数组，只读展示）", "category": "基本信息"},
  {"key": "Shortcut", "type": "text", "placeholder": "如 ⌘⇧1", "description": "A keyboard shortcut to switch to this profile.", "zh": "切换到此配置的快捷键", "category": "基本信息"},
  {"key": "Custom Command", "type": "yesno", "description": "Whether to run a custom command instead of the user's shell. Use \"Yes\"/\"No\".", "zh": "使用自定义命令（Yes/No）", "category": "基本信息"},
  {"key": "Command", "type": "text", "placeholder": "如 /usr/bin/zsh -l", "description": "The command to run when Custom Command is Yes.", "zh": "自定义命令（Custom Command 为 Yes 时生效）", "category": "基本信息"},
  {"key": "Initial Text", "type": "text", "placeholder": "如 echo hello", "description": "Text to send to the terminal when a new session is created.", "zh": "新建会话时自动输入的内容", "category": "基本信息"},
  {"key": "Description", "type": "text", "description": "A description of the profile.", "zh": "配置描述", "category": "基本信息"},
  {"key": "Badge Format", "type": "text", "placeholder": "如 \\u{1F512} [session] $\\u{1F3B5}", "description": "Format string for the badge shown in the tab. Supports session variables and escapes.", "zh": "标签页徽标格式（支持会话变量与转义）", "category": "基本信息"},
  {"key": "Icon", "type": "text", "placeholder": "图标名或路径", "description": "An icon for the profile, either a path to an image file or the name of a system icon.", "zh": "配置图标（图片路径或系统图标名）", "category": "基本信息"},
  {"key": "Job Name", "type": "text", "placeholder": "如 ssh", "description": "The name of the command running in the session, used by automatic profile switching.", "zh": "作业名称（自动切换配置的匹配依据）", "category": "基本信息"},
  // 字体与渲染
  {"key": "Normal Font", "type": "text", "placeholder": "如 JetBrainsMonoNerdFont-Regular 12", "description": "The font and size used for normal text, e.g. \"Menlo Regular 12\".", "zh": "常规字体（字体名 字号，如 JetBrainsMonoNerdFont-Regular 12）", "category": "字体与渲染"},
  {"key": "Non Ascii Font", "type": "text", "placeholder": "如 Menlo Regular 12", "description": "Font used for non-ASCII text when Use Non-ASCII Font is enabled.", "zh": "非 ASCII 字体（启用“使用非 ASCII 字体”时生效）", "category": "字体与渲染"},
  {"key": "Non-ASCII Font Vertical Spacing", "type": "number", "placeholder": "如 1", "description": "Vertical spacing adjustment (as a fraction) applied to the non-ASCII font.", "zh": "非 ASCII 字体垂直间距调整（比例值）", "category": "字体与渲染"},
  {"key": "Horizontal Spacing", "type": "number", "placeholder": "如 1", "description": "A multiplier for the horizontal spacing of cells.", "zh": "字符水平间距（倍数，1 为默认）", "category": "字体与渲染"},
  {"key": "Vertical Spacing", "type": "number", "placeholder": "如 1", "description": "A multiplier for the vertical spacing of cells.", "zh": "字符垂直间距（倍数，1 为默认）", "category": "字体与渲染"},
  {"key": "Use Bold Font", "type": "bool", "description": "Whether to use the bold variant of the font.", "zh": "使用粗体字重", "category": "字体与渲染"},
  {"key": "Use Bright Bold", "type": "bool", "description": "Whether bright colors should be rendered with the bold font weight.", "zh": "明亮色使用粗体渲染", "category": "字体与渲染"},
  {"key": "Use Italic Font", "type": "bool", "description": "Whether to use the italic variant of the font.", "zh": "使用斜体字重", "category": "字体与渲染"},
  {"key": "ASCII Anti Aliased", "type": "bool", "description": "Whether ASCII text is anti-aliased.", "zh": "ASCII 字符抗锯齿", "category": "字体与渲染"},
  {"key": "Non-ASCII Anti Aliased", "type": "bool", "description": "Whether non-ASCII text is anti-aliased.", "zh": "非 ASCII 字符抗锯齿", "category": "字体与渲染"},
  {"key": "Use Non-ASCII Font", "type": "bool", "description": "Whether to use the non-ASCII font for non-ASCII characters.", "zh": "非 ASCII 字符使用独立字体", "category": "字体与渲染"},
  {"key": "Draw Powerline Glyphs", "type": "bool", "description": "Whether to draw Powerline glyphs.", "zh": "绘制 Powerline 字形", "category": "字体与渲染"},
  {"key": "Ambiguous Double Width", "type": "bool", "description": "Whether ambiguous-width characters are rendered at double width.", "zh": "歧义宽度字符按双倍宽度显示", "category": "字体与渲染"},
  {"key": "Minimum Contrast", "type": "number", "min": 0, "max": 1, "placeholder": "如 0.2", "description": "A value from 0 to 1 controlling the minimum contrast of text against the background.", "zh": "文字与背景最小对比度（0-1）", "category": "字体与渲染"},
  {"key": "Cursor Boost", "type": "number", "min": 0, "max": 1, "placeholder": "如 0.5", "description": "How much to brighten the cursor area to improve visibility (0-1).", "zh": "光标区域提亮程度（0-1）", "category": "字体与渲染"},
  {"key": "Use Thicker Strokes", "type": "bool", "description": "Whether to draw text with thicker strokes (macOS only).", "zh": "使用更粗笔画（macOS only）", "category": "字体与渲染"},
  {"key": "Thin Strokes", "type": "enum", "enum": ["never", "retina", "always"], "description": "When to draw thin strokes: never, on retina displays, or always (macOS only).", "zh": "细笔画渲染时机：never/retina/always（macOS only）", "category": "字体与渲染"},
  {"key": "Font Antialiasing", "type": "enum", "enum": ["yes", "no", "syspref"], "description": "Whether font antialiasing is enabled, following the system preference when syspref.", "zh": "字体抗锯齿：yes/no/syspref", "category": "字体与渲染"},
  {"key": "Unicode Normalization", "type": "enum", "enum": ["none", "nfc", "nfd", "hfkd"], "description": "The Unicode normalization form applied to text: none, NFC, NFD, or HFS+ (HFKD).", "zh": "Unicode 归一化：none/nfc/nfd/hfkd", "category": "字体与渲染"},
  // 外观与主题
  {"key": "Background Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "The terminal background color. In JSON it is an array like [0.33, 0.13, 0.14, 1].", "zh": "背景色（JSON 为 [r,g,b,a] 数组）", "category": "外观与主题"},
  {"key": "Foreground Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "The terminal foreground (text) color. Array form like [0.9, 0.9, 0.9, 1].", "zh": "前景色（文字颜色）", "category": "外观与主题"},
  {"key": "Bold Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color used for bold text.", "zh": "粗体文字颜色", "category": "外观与主题"},
  {"key": "Link Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color used for links.", "zh": "链接颜色", "category": "外观与主题"},
  {"key": "Selection Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Background color of selected text.", "zh": "选中文本背景色", "category": "外观与主题"},
  {"key": "Selected Text Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Foreground color of selected text.", "zh": "选中文本前景色", "category": "外观与主题"},
  {"key": "Cursor Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of the cursor.", "zh": "光标颜色", "category": "外观与主题"},
  {"key": "Cursor Text Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of text underneath the cursor.", "zh": "光标处文字颜色", "category": "外观与主题"},
  {"key": "Cursor Guide Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of the cursor guide line (visible when the cursor is highlighted).", "zh": "光标引导线颜色", "category": "外观与主题"},
  {"key": "Ansi 0 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 0 (black).", "zh": "ANSI 0 色（黑）", "category": "外观与主题"},
  {"key": "Ansi 1 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 1 (red).", "zh": "ANSI 1 色（红）", "category": "外观与主题"},
  {"key": "Ansi 2 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 2 (green).", "zh": "ANSI 2 色（绿）", "category": "外观与主题"},
  {"key": "Ansi 3 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 3 (yellow).", "zh": "ANSI 3 色（黄）", "category": "外观与主题"},
  {"key": "Ansi 4 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 4 (blue).", "zh": "ANSI 4 色（蓝）", "category": "外观与主题"},
  {"key": "Ansi 5 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 5 (magenta).", "zh": "ANSI 5 色（品红）", "category": "外观与主题"},
  {"key": "Ansi 6 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 6 (cyan).", "zh": "ANSI 6 色（青）", "category": "外观与主题"},
  {"key": "Ansi 7 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 7 (white).", "zh": "ANSI 7 色（白）", "category": "外观与主题"},
  {"key": "Ansi 8 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 8 (bright black).", "zh": "ANSI 8 色（亮黑）", "category": "外观与主题"},
  {"key": "Ansi 9 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 9 (bright red).", "zh": "ANSI 9 色（亮红）", "category": "外观与主题"},
  {"key": "Ansi 10 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 10 (bright green).", "zh": "ANSI 10 色（亮绿）", "category": "外观与主题"},
  {"key": "Ansi 11 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 11 (bright yellow).", "zh": "ANSI 11 色（亮黄）", "category": "外观与主题"},
  {"key": "Ansi 12 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 12 (bright blue).", "zh": "ANSI 12 色（亮蓝）", "category": "外观与主题"},
  {"key": "Ansi 13 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 13 (bright magenta).", "zh": "ANSI 13 色（亮品红）", "category": "外观与主题"},
  {"key": "Ansi 14 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 14 (bright cyan).", "zh": "ANSI 14 色（亮青）", "category": "外观与主题"},
  {"key": "Ansi 15 Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of ANSI color 15 (bright white).", "zh": "ANSI 15 色（亮白）", "category": "外观与主题"},
  {"key": "Use Transparency", "type": "bool", "description": "Whether the terminal background is transparent.", "zh": "启用背景透明", "category": "外观与主题"},
  {"key": "Transparency", "type": "number", "min": 0, "max": 1, "placeholder": "如 0.2", "description": "A value from 0 to 1 controlling background transparency.", "zh": "背景透明度（0-1）", "category": "外观与主题"},
  {"key": "Blur", "type": "bool", "description": "Whether the background is blurred when transparent.", "zh": "透明背景启用模糊", "category": "外观与主题"},
  {"key": "Blur Radius", "type": "number", "min": 0, "max": 30, "placeholder": "如 15", "description": "The blur radius (0-30) applied to the background.", "zh": "背景模糊半径（0-30）", "category": "外观与主题"},
  {"key": "Background Image Location", "type": "text", "placeholder": "背景图路径", "description": "Path to an image used as the terminal background.", "zh": "背景图片路径", "category": "外观与主题"},
  {"key": "Background Image Mode", "type": "enum", "enum": ["stretch", "tile", "center"], "description": "How the background image is fit: stretch, tile, or center.", "zh": "背景图模式：stretch/tile/center", "category": "外观与主题"},
  {"key": "Use Tab Color", "type": "bool", "description": "Whether the tab color is overridden by this profile's Tab Color.", "zh": "使用配置的标签页颜色", "category": "外观与主题"},
  {"key": "Tab Color", "type": "color", "placeholder": "#hex 或 [r,g,b,a]", "description": "Color of the tab for sessions with this profile (when Use Tab Color is enabled).", "zh": "标签页颜色（需开启“使用标签页颜色”）", "category": "外观与主题"},
  // 光标
  {"key": "Cursor Type", "type": "enum", "enum": ["box", "bar", "underline", "vertical bar"], "description": "The cursor shape: box, bar, underline, or vertical bar.", "zh": "光标样式：box/bar/underline/vertical bar", "category": "光标"},
  {"key": "Blinking Cursor", "type": "bool", "description": "Whether the cursor blinks.", "zh": "光标闪烁", "category": "光标"},
  // 行为与终端
  {"key": "Scrollback Lines", "type": "number", "min": 0, "placeholder": "如 10000", "description": "The number of scrollback lines to keep.", "zh": "回滚缓冲行数", "category": "行为与终端"},
  {"key": "Use Scrollback", "type": "bool", "description": "Whether scrollback is enabled.", "zh": "启用回滚缓冲", "category": "行为与终端"},
  {"key": "Unlimited Scrollback", "type": "bool", "description": "Whether scrollback is unlimited.", "zh": "无限回滚缓冲", "category": "行为与终端"},
  {"key": "Mouse Reporting", "type": "enum", "enum": ["no", "yes", "xterm", "xterm+fn"], "description": "Mouse reporting mode: no, yes, xterm, or xterm+fn.", "zh": "鼠标上报模式：no/yes/xterm/xterm+fn", "category": "行为与终端"},
  {"key": "Option Key Sends", "type": "enum", "enum": ["normal", "esc", "ctrl"], "description": "What the left Option key sends: normal, escape (esc), or control (ctrl).", "zh": "左 Option 键行为：normal/esc/ctrl", "category": "行为与终端"},
  {"key": "Right Option Key Sends", "type": "enum", "enum": ["normal", "esc", "ctrl"], "description": "What the right Option key sends: normal, escape (esc), or control (ctrl).", "zh": "右 Option 键行为：normal/esc/ctrl", "category": "行为与终端"},
  {"key": "Delete Key Sends ^H", "type": "bool", "description": "Whether the delete key sends ^H.", "zh": "删除键发送 ^H", "category": "行为与终端"},
  {"key": "Silence Bell", "type": "bool", "description": "Whether the bell is silenced.", "zh": "静默响铃", "category": "行为与终端"},
  {"key": "Visual Bell", "type": "bool", "description": "Whether the bell flashes the screen.", "zh": "视觉响铃（闪屏）", "category": "行为与终端"},
  {"key": "Flashing Bell", "type": "bool", "description": "Whether the bell makes the tab icon flash.", "zh": "闪烁响铃（标签图标闪烁）", "category": "行为与终端"},
  {"key": "Bell Sound", "type": "bool", "description": "Whether the bell plays a sound.", "zh": "响铃播放声音", "category": "行为与终端"},
  {"key": "Show Bell Indicator", "type": "bool", "description": "Whether the bell indicator is shown in the tab.", "zh": "标签页显示响铃指示", "category": "行为与终端"},
  {"key": "Scroll Wheel Sends Arrow Keys", "type": "bool", "description": "Whether the scroll wheel sends arrow keys to the terminal.", "zh": "滚动条发送方向键给终端", "category": "行为与终端"},
  {"key": "Character Encoding", "type": "text", "placeholder": "如 UTF-8", "description": "The character encoding used by the session, e.g. UTF-8.", "zh": "字符编码（如 UTF-8）", "category": "行为与终端"},
  {"key": "Close Sessions On End", "type": "bool", "description": "Whether sessions close when the command ends.", "zh": "命令结束后关闭会话", "category": "行为与终端"},
  {"key": "Prompt Before Closing", "type": "enum", "enum": ["always", "no", "never", "unless-job"], "description": "When to prompt before closing: always, no, never, or unless-job.", "zh": "关闭前确认时机：always/no/never/unless-job", "category": "行为与终端"},
  {"key": "When Idle Sends ASCII Code", "type": "number", "min": 0, "placeholder": "如 0", "description": "The ASCII code sent when the session is idle (see Send Code When Idle).", "zh": "空闲时发送的 ASCII 码值", "category": "行为与终端"},
  {"key": "Send Code When Idle", "type": "bool", "description": "Whether an ASCII code is sent to the session when idle.", "zh": "空闲时向会话发送代码", "category": "行为与终端"},
  {"key": "Idle Code", "type": "number", "min": 0, "placeholder": "如 0", "description": "The ASCII code sent when idle (equivalent to When Idle Sends ASCII Code).", "zh": "空闲发送码（同 When Idle Sends ASCII Code）", "category": "行为与终端"},
  {"key": "Sync Title", "type": "bool", "description": "Whether the window and tab titles are synchronized.", "zh": "窗口与标签标题同步", "category": "行为与终端"},
  {"key": "Terminal Columns", "type": "number", "min": 1, "placeholder": "如 80", "description": "The number of columns of the terminal window.", "zh": "终端窗口列数", "category": "行为与终端"},
  {"key": "Terminal Rows", "type": "number", "min": 1, "placeholder": "如 25", "description": "The number of rows of the terminal window.", "zh": "终端窗口行数", "category": "行为与终端"},
  {"key": "Window Title", "type": "text", "placeholder": "窗口标题", "description": "The title of the window.", "zh": "窗口标题", "category": "行为与终端"},
  {"key": "Smart Window Resizing", "type": "bool", "description": "Whether the window resizes smartly when the session size changes.", "zh": "会话尺寸变化时智能调整窗口", "category": "行为与终端"},
  {"key": "Directory", "type": "text", "placeholder": "如 ~/projects", "description": "The working directory of new sessions for this profile.", "zh": "新建会话的工作目录", "category": "行为与终端"},
  // 键盘与按键（复杂结构，只读展示）
  {"key": "Keyboard Map", "type": "text", "description": "The keyboard mapping (object). Complex value shown read-only in the form.", "zh": "按键映射（对象，只读展示）", "category": "键盘与按键"},
  {"key": "Triggers", "type": "text", "description": "An array of triggers, each with a regular expression and action.", "zh": "触发器（数组，只读展示）", "category": "键盘与按键"},
  {"key": "Smart Selection Rules", "type": "text", "description": "An array of smart selection rules. Complex value shown read-only.", "zh": "智能选择规则（数组，只读展示）", "category": "键盘与按键"},
  {"key": "Automatic Profile Switching", "type": "text", "description": "An array of rules that switch profiles based on session state. Read-only in the form.", "zh": "自动切换配置规则（数组，只读展示）", "category": "键盘与按键"},
  {"key": "Semantic History", "type": "text", "description": "Configuration for semantic history (object). Read-only in the form.", "zh": "语义历史配置（对象，只读展示）", "category": "键盘与按键"},
];
