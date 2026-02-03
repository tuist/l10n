package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"golang.org/x/term"
)

type InitOptions struct {
	Reporter Reporter
}

func Init(root string, opts InitOptions) error {
	reporter := ensureReporter(opts.Reporter)
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return errors.New("init requires an interactive terminal")
	}

	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}

	l10nPath := filepath.Join(rootAbs, "L10N.md")
	if _, err := os.Stat(l10nPath); err == nil {
		return fmt.Errorf("L10N.md already exists at %s", l10nPath)
	} else if !os.IsNotExist(err) {
		return err
	}

	locales := defaultLocales()
	sourceLang, err := promptSourceLanguage(locales)
	if err != nil {
		return err
	}

	targets, err := promptTargetLanguages(locales, sourceLang)
	if err != nil {
		return err
	}

	content := renderL10NTemplate(sourceLang, targets, locales)
	if err := os.WriteFile(l10nPath, []byte(content), 0o644); err != nil {
		return err
	}
	reporter.Info("created L10N.md")

	gitignorePath := filepath.Join(rootAbs, ".gitignore")
	ignoreChanged, err := ensureLine(gitignorePath, "/.l10n/tmp")
	if err != nil {
		return err
	}
	if ignoreChanged {
		reporter.Info("updated .gitignore")
	}

	attributesPath := filepath.Join(rootAbs, ".gitattributes")
	attributesChanged, err := ensureLine(attributesPath, ".l10n/locks/** linguist-generated=true")
	if err != nil {
		return err
	}
	if attributesChanged {
		reporter.Info("updated .gitattributes")
	}

	reporter.Info("next steps:")
	reporter.Info("1. Open L10N.md and uncomment the example config.")
	reporter.Info("2. Update source globs, targets, and output paths for your repo.")
	reporter.Info("3. Set OPENAI_API_KEY (or change the provider/model settings).")
	reporter.Info("4. Run `l10n translate` to generate drafts.")

	return nil
}

func promptSourceLanguage(locales []Locale) (string, error) {
	model := newSelectModel(selectConfig{
		title:       "Source language",
		items:       localeItems(locales, ""),
		multi:       false,
		defaultCode: "en",
		hint:        "Type to filter | up/down to move | enter to confirm",
	})
	result, err := runSelect(model)
	if err != nil {
		return "", err
	}
	if result.choice == "" {
		return "", errors.New("no source language selected")
	}
	return result.choice, nil
}

func promptTargetLanguages(locales []Locale, sourceLang string) ([]string, error) {
	model := newSelectModel(selectConfig{
		title:       "Target languages",
		items:       localeItems(locales, sourceLang),
		multi:       true,
		hint:        "Type to filter | up/down to move | space to select | enter to confirm",
		requirePick: true,
	})
	result, err := runSelect(model)
	if err != nil {
		return nil, err
	}
	return result.selectedValues(), nil
}

func renderL10NTemplate(sourceLang string, targets []string, locales []Locale) string {
	sort.Strings(targets)
	localeNames := localeNameByCode(locales)

	sourceLabel := labelForLocale(sourceLang, localeNames)
	targetLabel := labelForLocales(targets, localeNames)

	var b strings.Builder
	b.WriteString("+++\n")
	b.WriteString("# Example configuration (uncomment to enable)\n")
	b.WriteString("# [llm]\n")
	b.WriteString("# provider = \"openai\"\n")
	b.WriteString("# api_key = \"{{env.OPENAI_API_KEY}}\"\n")
	b.WriteString("#\n")
	b.WriteString("# [[llm.agent]]\n")
	b.WriteString("# role = \"coordinator\"\n")
	b.WriteString("# model = \"gpt-4o-mini\"\n")
	b.WriteString("#\n")
	b.WriteString("# [[llm.agent]]\n")
	b.WriteString("# role = \"translator\"\n")
	b.WriteString("# model = \"gpt-4o\"\n")
	b.WriteString("#\n")
	b.WriteString("# [[translate]]\n")
	b.WriteString("# source = \"docs/**/*.md\"\n")
	b.WriteString(fmt.Sprintf("# targets = %s\n", formatTOMLArray(targets)))
	b.WriteString("# output = \"docs/i18n/{lang}/{relpath}\"\n")
	b.WriteString("+++\n\n")
	b.WriteString("Uncomment the example above, then describe your product and tone here.\n")
	b.WriteString(fmt.Sprintf("Source language: %s.\n", sourceLabel))
	b.WriteString(fmt.Sprintf("Target languages: %s.\n", targetLabel))
	b.WriteString("\n")
	return b.String()
}

func formatTOMLArray(values []string) string {
	if len(values) == 0 {
		return "[]"
	}
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, fmt.Sprintf("%q", value))
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

func labelForLocale(code string, names map[string]string) string {
	if name, ok := names[code]; ok && strings.TrimSpace(name) != "" {
		return name + " (" + code + ")"
	}
	return code
}

func labelForLocales(codes []string, names map[string]string) string {
	if len(codes) == 0 {
		return ""
	}
	labels := make([]string, 0, len(codes))
	for _, code := range codes {
		labels = append(labels, labelForLocale(code, names))
	}
	return strings.Join(labels, ", ")
}

func ensureLine(path, line string) (bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return true, os.WriteFile(path, []byte(line+"\n"), 0o644)
		}
		return false, err
	}

	content := strings.ReplaceAll(string(data), "\r\n", "\n")
	for _, existing := range strings.Split(content, "\n") {
		if strings.TrimSpace(existing) == strings.TrimSpace(line) {
			return false, nil
		}
	}

	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	content += line + "\n"
	return true, os.WriteFile(path, []byte(content), 0o644)
}

type localeItem struct {
	Code  string
	Label string
}

func localeItems(locales []Locale, exclude string) []localeItem {
	items := make([]localeItem, 0, len(locales))
	for _, locale := range locales {
		if locale.Code == exclude {
			continue
		}
		items = append(items, localeItem{
			Code:  locale.Code,
			Label: localeLabel(locale),
		})
	}
	return items
}

type selectConfig struct {
	title       string
	items       []localeItem
	multi       bool
	defaultCode string
	hint        string
	requirePick bool
}

type selectModel struct {
	title       string
	items       []localeItem
	filtered    []int
	filter      string
	cursor      int
	offset      int
	height      int
	width       int
	selected    map[string]bool
	multi       bool
	choice      string
	hint        string
	requirePick bool
	errMsg      string
	aborted     bool
	styles      selectStyles
}

func newSelectModel(cfg selectConfig) selectModel {
	model := selectModel{
		title:       cfg.title,
		items:       cfg.items,
		filtered:    make([]int, 0, len(cfg.items)),
		selected:    map[string]bool{},
		multi:       cfg.multi,
		hint:        cfg.hint,
		requirePick: cfg.requirePick,
		styles:      defaultSelectStyles(),
	}
	for i := range cfg.items {
		model.filtered = append(model.filtered, i)
		if cfg.defaultCode != "" && cfg.items[i].Code == cfg.defaultCode {
			model.cursor = len(model.filtered) - 1
		}
	}
	return model
}

func runSelect(model selectModel) (selectModel, error) {
	program := tea.NewProgram(model)
	result, err := program.Run()
	if err != nil {
		return model, err
	}
	final, ok := result.(selectModel)
	if !ok {
		return model, errors.New("unexpected selection result")
	}
	if final.aborted {
		return final, errors.New("init canceled")
	}
	return final, nil
}

func (m selectModel) Init() tea.Cmd {
	return nil
}

func (m selectModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.height = msg.Height
		m.width = msg.Width
		m.clampCursor()
		m.ensureCursorVisible()
		return m, nil
	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC, tea.KeyEsc:
			m.aborted = true
			return m, tea.Quit
		case tea.KeyEnter:
			if m.multi {
				if m.requirePick && len(m.selected) == 0 {
					m.errMsg = "Select at least one item to continue."
					return m, nil
				}
				return m, tea.Quit
			}
			if idx := m.currentIndex(); idx >= 0 {
				m.choice = m.items[idx].Code
			}
			return m, tea.Quit
		case tea.KeySpace:
			if m.multi {
				m.toggleSelection()
			}
			return m, nil
		case tea.KeyUp:
			if m.cursor > 0 {
				m.cursor--
			}
			m.ensureCursorVisible()
			return m, nil
		case tea.KeyDown:
			if m.cursor < len(m.filtered)-1 {
				m.cursor++
			}
			m.ensureCursorVisible()
			return m, nil
		case tea.KeyBackspace, tea.KeyCtrlH:
			if m.filter != "" {
				m.filter = m.filter[:len(m.filter)-1]
				m.applyFilter()
			}
			return m, nil
		case tea.KeyCtrlU:
			if m.filter != "" {
				m.filter = ""
				m.applyFilter()
			}
			return m, nil
		case tea.KeyRunes:
			if len(msg.Runes) > 0 {
				m.filter += string(msg.Runes)
				m.applyFilter()
			}
			return m, nil
		}
	}
	return m, nil
}

func (m selectModel) View() string {
	var b strings.Builder
	if strings.TrimSpace(m.title) != "" {
		b.WriteString(m.styles.title.Render(m.title))
		b.WriteString("\n")
	}
	b.WriteString(m.styles.filterLabel.Render("Filter: "))
	if m.filter == "" {
		b.WriteString(m.styles.filterPlaceholder.Render("type to filter"))
	} else {
		b.WriteString(m.styles.filterValue.Render(m.filter))
	}
	if len(m.items) > 0 {
		b.WriteString(m.styles.count.Render(fmt.Sprintf(" (%d/%d)", len(m.filtered), len(m.items))))
	}
	b.WriteString("\n\n")

	if len(m.filtered) == 0 {
		b.WriteString(m.styles.muted.Render("No matches."))
		b.WriteString("\n")
	} else {
		visible := m.visibleIndices()
		for i, idx := range visible {
			item := m.items[idx]
			isCursor := m.offset+i == m.cursor
			cursor := " "
			cursorStyle := m.styles.cursor
			itemStyle := m.styles.item
			if isCursor {
				cursor = ">"
				itemStyle = m.styles.itemActive
			}
			cursorText := cursorStyle.Render(cursor)
			if m.multi {
				mark := " "
				markStyle := m.styles.markInactive
				if m.selected[item.Code] {
					mark = "x"
					markStyle = m.styles.markActive
				}
				markText := markStyle.Render(mark)
				b.WriteString(fmt.Sprintf("%s [%s] %s\n", cursorText, markText, itemStyle.Render(item.Label)))
			} else {
				b.WriteString(fmt.Sprintf("%s %s\n", cursorText, itemStyle.Render(item.Label)))
			}
		}
	}

	if m.errMsg != "" {
		b.WriteString("\n")
		b.WriteString(m.styles.error.Render(m.errMsg))
		b.WriteString("\n")
	}

	if strings.TrimSpace(m.hint) != "" {
		b.WriteString("\n")
		b.WriteString(m.styles.hint.Render(m.hint))
	}
	return b.String()
}

func (m *selectModel) applyFilter() {
	filter := strings.TrimSpace(strings.ToLower(m.filter))
	m.filtered = m.filtered[:0]
	for i, item := range m.items {
		if filter == "" || fuzzyMatch(filter, strings.ToLower(item.Label)) || fuzzyMatch(filter, strings.ToLower(item.Code)) {
			m.filtered = append(m.filtered, i)
		}
	}
	if m.cursor >= len(m.filtered) {
		m.cursor = max(0, len(m.filtered)-1)
	}
	m.offset = 0
	m.ensureCursorVisible()
	m.errMsg = ""
}

func (m *selectModel) toggleSelection() {
	idx := m.currentIndex()
	if idx < 0 {
		return
	}
	code := m.items[idx].Code
	if m.selected[code] {
		delete(m.selected, code)
	} else {
		m.selected[code] = true
	}
	m.errMsg = ""
}

func (m selectModel) currentIndex() int {
	if len(m.filtered) == 0 || m.cursor < 0 || m.cursor >= len(m.filtered) {
		return -1
	}
	return m.filtered[m.cursor]
}

func (m selectModel) selectedValues() []string {
	if len(m.selected) == 0 {
		return nil
	}
	values := make([]string, 0, len(m.selected))
	for _, item := range m.items {
		if m.selected[item.Code] {
			values = append(values, item.Code)
		}
	}
	return values
}

func (m selectModel) visibleIndices() []int {
	if len(m.filtered) == 0 {
		return nil
	}
	listHeight := m.listHeight()
	if listHeight <= 0 || listHeight >= len(m.filtered) {
		return m.filtered
	}
	start := m.offset
	if start < 0 {
		start = 0
	}
	end := start + listHeight
	if end > len(m.filtered) {
		end = len(m.filtered)
	}
	return m.filtered[start:end]
}

func (m selectModel) listHeight() int {
	if m.height <= 0 {
		return 0
	}
	height := m.height - m.headerLines() - m.footerLines()
	if height < 1 {
		height = 1
	}
	return height
}

func (m selectModel) headerLines() int {
	lines := 1 // filter line
	if strings.TrimSpace(m.title) != "" {
		lines++
	}
	lines++ // blank line after filter
	return lines
}

func (m selectModel) footerLines() int {
	lines := 0
	if m.errMsg != "" {
		lines += 2 // blank line + error
	}
	if strings.TrimSpace(m.hint) != "" {
		lines += 2 // blank line + hint
	}
	return lines
}

func (m *selectModel) ensureCursorVisible() {
	if len(m.filtered) == 0 {
		m.cursor = 0
		m.offset = 0
		return
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
	if m.cursor >= len(m.filtered) {
		m.cursor = len(m.filtered) - 1
	}
	listHeight := m.listHeight()
	if listHeight <= 0 {
		m.offset = 0
		return
	}
	if m.cursor < m.offset {
		m.offset = m.cursor
	}
	if m.cursor >= m.offset+listHeight {
		m.offset = m.cursor - listHeight + 1
	}
	if maxOffset := len(m.filtered) - listHeight; m.offset > maxOffset {
		if maxOffset < 0 {
			m.offset = 0
		} else {
			m.offset = maxOffset
		}
	}
	if m.offset < 0 {
		m.offset = 0
	}
}

func (m *selectModel) clampCursor() {
	if len(m.filtered) == 0 {
		m.cursor = 0
		return
	}
	if m.cursor >= len(m.filtered) {
		m.cursor = len(m.filtered) - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
}

func fuzzyMatch(needle, haystack string) bool {
	if needle == "" {
		return true
	}
	needleRunes := []rune(needle)
	haystackRunes := []rune(haystack)
	i := 0
	for _, r := range haystackRunes {
		if r == needleRunes[i] {
			i++
			if i == len(needleRunes) {
				return true
			}
		}
	}
	return false
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

type selectStyles struct {
	title             lipgloss.Style
	filterLabel       lipgloss.Style
	filterValue       lipgloss.Style
	filterPlaceholder lipgloss.Style
	count             lipgloss.Style
	item              lipgloss.Style
	itemActive        lipgloss.Style
	cursor            lipgloss.Style
	markActive        lipgloss.Style
	markInactive      lipgloss.Style
	hint              lipgloss.Style
	error             lipgloss.Style
	muted             lipgloss.Style
}

func defaultSelectStyles() selectStyles {
	return selectStyles{
		title:             lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("81")),
		filterLabel:       lipgloss.NewStyle().Foreground(lipgloss.Color("245")),
		filterValue:       lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("252")),
		filterPlaceholder: lipgloss.NewStyle().Foreground(lipgloss.Color("241")),
		count:             lipgloss.NewStyle().Foreground(lipgloss.Color("242")),
		item:              lipgloss.NewStyle().Foreground(lipgloss.Color("251")),
		itemActive:        lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("229")),
		cursor:            lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("214")),
		markActive:        lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("42")),
		markInactive:      lipgloss.NewStyle().Foreground(lipgloss.Color("239")),
		hint:              lipgloss.NewStyle().Foreground(lipgloss.Color("244")),
		error:             lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("196")),
		muted:             lipgloss.NewStyle().Foreground(lipgloss.Color("241")),
	}
}
