package mail

import (
	"fmt"
	"net/url"
	"time"
)

// The emails' texts, in the site's languages. A locale the server does not
// know gets English. Each email is a letter: written once, sent as plain
// text and as HTML (letter.go).

// Locale is a language the emails are written in.
type Locale string

const (
	English Locale = "en"
	Russian Locale = "ru"
)

// ParseLocale returns the email language for a requested locale, English by default.
func ParseLocale(value string) Locale {
	if Locale(value) == Russian {
		return Russian
	}
	return English
}

func minutes(d time.Duration) int {
	return int(d.Round(time.Minute) / time.Minute)
}

// footer says why the email came, under every letter: the address was
// entered on the site, or (account) it is an account's.
func footer(locale Locale, siteURL string, account bool) string {
	host := siteURL
	if u, err := url.Parse(siteURL); err == nil && u.Host != "" {
		host = u.Host
	}
	switch {
	case locale == Russian && account:
		return fmt.Sprintf("Вы получили это письмо, потому что у вас есть аккаунт Konspecter на %s.", host)
	case locale == Russian:
		return fmt.Sprintf("Вы получили это письмо, потому что этот адрес ввели на %s.", host)
	case account:
		return fmt.Sprintf("You received this email because you have a Konspecter account on %s.", host)
	}
	return fmt.Sprintf("You received this email because this address was entered on %s.", host)
}

// SignInCode is the email with a sign-in code. newAccount says whether
// entering it creates the account.
func SignInCode(locale Locale, siteURL, to, code string, ttl time.Duration, newAccount bool) Message {
	l := letter{locale: locale, siteURL: siteURL, code: code}
	switch {
	case locale == Russian && newAccount:
		l.subject = fmt.Sprintf("Код для регистрации в Konspecter: %s", code)
		l.title = "Код для регистрации"
		l.intro = []string{"Ваш код для создания аккаунта Konspecter:"}
		l.outro = []string{
			fmt.Sprintf("Введите его на странице, где вы его запросили. Код действует %d мин.", minutes(ttl)),
			"Если вы не регистрировались в Konspecter, просто удалите это письмо.",
		}
	case locale == Russian:
		l.subject = fmt.Sprintf("Код для входа в Konspecter: %s", code)
		l.title = "Код для входа"
		l.intro = []string{"Ваш код для входа в Konspecter:"}
		l.outro = []string{
			fmt.Sprintf("Введите его на странице, где вы его запросили. Код действует %d мин.", minutes(ttl)),
			"Если вы не входили в Konspecter, просто удалите это письмо: без кода войти нельзя.",
		}
	case newAccount:
		l.subject = fmt.Sprintf("Your Konspecter sign-up code: %s", code)
		l.title = "Your sign-up code"
		l.intro = []string{"Your code to create a Konspecter account:"}
		l.outro = []string{
			fmt.Sprintf("Enter it on the page where you asked for it. It works for %d minutes.", minutes(ttl)),
			"If you did not sign up for Konspecter, you can delete this email.",
		}
	default:
		l.subject = fmt.Sprintf("Your Konspecter sign-in code: %s", code)
		l.title = "Your sign-in code"
		l.intro = []string{"Your code to sign in to Konspecter:"}
		l.outro = []string{
			fmt.Sprintf("Enter it on the page where you asked for it. It works for %d minutes.", minutes(ttl)),
			"If you did not try to sign in, you can delete this email: nobody gets in without the code.",
		}
	}
	return l.message(to)
}

// RegistrationClosed answers a code request for an address without an
// account when the server takes no new accounts.
func RegistrationClosed(locale Locale, siteURL, to string) Message {
	l := letter{locale: locale, siteURL: siteURL}
	if locale == Russian {
		l.subject = "Аккаунт Konspecter не найден"
		l.title = "Аккаунт не найден"
		l.intro = []string{
			"Кто-то запросил код для входа в Konspecter с этим адресом, но аккаунта с ним нет, " +
				"а регистрация на этом сервере закрыта.",
			"Если это были не вы, просто удалите это письмо.",
		}
	} else {
		l.subject = "No Konspecter account for this address"
		l.title = "No account for this address"
		l.intro = []string{
			"Someone asked for a Konspecter sign-in code for this address, but there is no account " +
				"with it and this server does not take new accounts.",
			"If it was not you, you can delete this email.",
		}
	}
	return l.message(to)
}

// PasswordReset carries the link to set a new password.
func PasswordReset(locale Locale, siteURL, to, link string, ttl time.Duration) Message {
	l := letter{locale: locale, siteURL: siteURL}
	if locale == Russian {
		l.subject = "Новый пароль для Konspecter"
		l.title = "Новый пароль"
		l.intro = []string{"Чтобы задать новый пароль, откройте ссылку:"}
		l.link = &button{URL: link, Label: "Задать новый пароль"}
		l.outro = []string{
			fmt.Sprintf("Ссылка действует %d мин. и сработает один раз. После смены пароля все устройства, "+
				"где вы вошли на сайт, выйдут из аккаунта.", minutes(ttl)),
			"Если вы не просили сменить пароль, просто удалите это письмо: пароль останется прежним.",
		}
	} else {
		l.subject = "Set a new Konspecter password"
		l.title = "Set a new password"
		l.intro = []string{"To set a new password, open this link:"}
		l.link = &button{URL: link, Label: "Set a new password"}
		l.outro = []string{
			fmt.Sprintf("It works for %d minutes, once. Setting a new password signs you out of the site everywhere.", minutes(ttl)),
			"If you did not ask for a new password, you can delete this email: your password stays as it is.",
		}
	}
	return l.message(to)
}

// NoAccount answers a password reset request for an address without an account.
func NoAccount(locale Locale, siteURL, to string) Message {
	l := letter{locale: locale, siteURL: siteURL}
	register := siteURL + "/register"
	if locale == Russian {
		l.subject = "Аккаунт Konspecter не найден"
		l.title = "Аккаунт не найден"
		l.intro = []string{
			"Кто-то попросил сменить пароль Konspecter для этого адреса, но аккаунта с ним нет.",
			"Создать аккаунт можно здесь:",
		}
		l.link = &button{URL: register, Label: "Создать аккаунт"}
		l.outro = []string{"Если это были не вы, просто удалите это письмо."}
	} else {
		l.subject = "No Konspecter account for this address"
		l.title = "No account for this address"
		l.intro = []string{
			"Someone asked to reset a Konspecter password for this address, but there is no account with it.",
			"You can create one here:",
		}
		l.link = &button{URL: register, Label: "Create an account"}
		l.outro = []string{"If it was not you, you can delete this email."}
	}
	return l.message(to)
}
