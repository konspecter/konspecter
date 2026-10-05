package mail

import (
	"fmt"
	"time"
)

// The emails' texts, in the site's languages. A locale the server does not
// know gets English.

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

// SignInCode is the email with a sign-in code. newAccount says whether
// entering it creates the account.
func SignInCode(locale Locale, to, code string, ttl time.Duration, newAccount bool) Message {
	m := Message{To: to}
	switch {
	case locale == Russian && newAccount:
		m.Subject = fmt.Sprintf("Код для регистрации в Konspecter: %s", code)
		m.Text = fmt.Sprintf("Ваш код для создания аккаунта Konspecter:\n\n    %s\n\n"+
			"Введите его на странице, где вы его запросили. Код действует %d мин.\n\n"+
			"Если вы не регистрировались в Konspecter, просто удалите это письмо.\n", code, minutes(ttl))
	case locale == Russian:
		m.Subject = fmt.Sprintf("Код для входа в Konspecter: %s", code)
		m.Text = fmt.Sprintf("Ваш код для входа в Konspecter:\n\n    %s\n\n"+
			"Введите его на странице, где вы его запросили. Код действует %d мин.\n\n"+
			"Если вы не входили в Konspecter, просто удалите это письмо: без кода войти нельзя.\n", code, minutes(ttl))
	case newAccount:
		m.Subject = fmt.Sprintf("Your Konspecter sign-up code: %s", code)
		m.Text = fmt.Sprintf("Your code to create a Konspecter account:\n\n    %s\n\n"+
			"Enter it on the page where you asked for it. It works for %d minutes.\n\n"+
			"If you did not sign up for Konspecter, you can delete this email.\n", code, minutes(ttl))
	default:
		m.Subject = fmt.Sprintf("Your Konspecter sign-in code: %s", code)
		m.Text = fmt.Sprintf("Your code to sign in to Konspecter:\n\n    %s\n\n"+
			"Enter it on the page where you asked for it. It works for %d minutes.\n\n"+
			"If you did not try to sign in, you can delete this email: nobody gets in without the code.\n", code, minutes(ttl))
	}
	return m
}

// RegistrationClosed answers a code request for an address without an
// account when the server takes no new accounts.
func RegistrationClosed(locale Locale, to string) Message {
	if locale == Russian {
		return Message{To: to, Subject: "Аккаунт Konspecter не найден",
			Text: "Кто-то запросил код для входа в Konspecter с этим адресом, но аккаунта с ним нет, " +
				"а регистрация на этом сервере закрыта.\n\nЕсли это были не вы, просто удалите это письмо.\n"}
	}
	return Message{To: to, Subject: "No Konspecter account for this address",
		Text: "Someone asked for a Konspecter sign-in code for this address, but there is no account " +
			"with it and this server does not take new accounts.\n\nIf it was not you, you can delete this email.\n"}
}

// PasswordReset carries the link to set a new password.
func PasswordReset(locale Locale, to, link string, ttl time.Duration) Message {
	if locale == Russian {
		return Message{To: to, Subject: "Новый пароль для Konspecter",
			Text: fmt.Sprintf("Чтобы задать новый пароль, откройте ссылку:\n\n%s\n\n"+
				"Ссылка действует %d мин. и сработает один раз. После смены пароля все устройства, "+
				"где вы вошли на сайт, выйдут из аккаунта.\n\n"+
				"Если вы не просили сменить пароль, просто удалите это письмо: пароль останется прежним.\n",
				link, minutes(ttl))}
	}
	return Message{To: to, Subject: "Set a new Konspecter password",
		Text: fmt.Sprintf("To set a new password, open this link:\n\n%s\n\n"+
			"It works for %d minutes, once. Setting a new password signs you out of the site everywhere.\n\n"+
			"If you did not ask for a new password, you can delete this email: your password stays as it is.\n",
			link, minutes(ttl))}
}

// NoAccount answers a password reset request for an address without an account.
func NoAccount(locale Locale, to, siteURL string) Message {
	if locale == Russian {
		return Message{To: to, Subject: "Аккаунт Konspecter не найден",
			Text: fmt.Sprintf("Кто-то попросил сменить пароль Konspecter для этого адреса, но аккаунта с ним нет.\n\n"+
				"Создать аккаунт можно здесь: %s/register\n\nЕсли это были не вы, просто удалите это письмо.\n", siteURL)}
	}
	return Message{To: to, Subject: "No Konspecter account for this address",
		Text: fmt.Sprintf("Someone asked to reset a Konspecter password for this address, but there is no account with it.\n\n"+
			"You can create one here: %s/register\n\nIf it was not you, you can delete this email.\n", siteURL)}
}
