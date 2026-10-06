package mail

import (
	"bytes"
	_ "embed"
	"html/template"
	"strings"
)

// letter is one email's content: a title, paragraphs, a code to type or a
// link to open, more paragraphs, and a footer. It is written once and sent
// both as plain text and as HTML, the logo at the top, everything else
// centred on a card.
type letter struct {
	locale  Locale
	siteURL string
	subject string
	title   string
	intro   []string
	// code is shown large; link as a button. A letter has at most one of them.
	code  string
	link  *button
	outro []string
}

type button struct {
	URL   string
	Label string
}

// logoPNG is the logo at the top of the HTML, sent with the message
// (Content-ID logoID): mail apps do not show SVG and often block remote
// images. scripts/render-icons.mjs renders it.
//
//go:embed logo.png
var logoPNG []byte

const logoID = "logo@konspecter"

//go:embed letter.html
var letterHTML string

var letterTemplate = template.Must(template.New("letter").Parse(letterHTML))

func (l letter) message(to string) Message {
	return Message{To: to, Subject: l.subject, Text: l.text(), HTML: l.html()}
}

// text is the plain-text version: paragraphs split by blank lines, the code
// indented on its own line, the link as its address.
func (l letter) text() string {
	parts := append([]string{}, l.intro...)
	switch {
	case l.code != "":
		parts = append(parts, "    "+l.code)
	case l.link != nil:
		parts = append(parts, l.link.URL)
	}
	parts = append(parts, l.outro...)
	return strings.Join(parts, "\n\n") + "\n"
}

func (l letter) html() string {
	linkHint := "If the button does not work, open this link:"
	if l.locale == Russian {
		linkHint = "Если кнопка не работает, откройте ссылку:"
	}
	var b bytes.Buffer
	err := letterTemplate.Execute(&b, map[string]any{
		"Lang":     string(l.locale),
		"Subject":  l.subject,
		"Title":    l.title,
		"Intro":    l.intro,
		"Code":     l.code,
		"Link":     l.link,
		"LinkHint": linkHint,
		"Outro":    l.outro,
		"Footer":   footer(l.locale, l.siteURL),
		"SiteURL":  l.siteURL,
	})
	if err != nil {
		// The template and its data are the package's own, so this does not
		// happen (tests render every letter); the plain text still goes out.
		return ""
	}
	return b.String()
}
