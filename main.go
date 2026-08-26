package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/Tnze/go-mc/bot"
	"github.com/Tnze/go-mc/bot/basic"
	_ "github.com/Tnze/go-mc/data/lang/en-us"
)

var (
	mcHost   = getEnv("MC_HOST", "144.31.46.15")
	mcPort   = getEnvInt("MC_PORT", 10486)
	mcUser   = getEnv("MC_USER", "KeepAliveBot")
	httpPort = getEnv("PORT", "8080")
	isOnline = false
	mu       sync.Mutex
)

func getEnv(key, def string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return def
}

func getEnvInt(key string, def int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return def
}

func runBot() {
	for {
		log.Printf("[+] Connecting pure Go bot to %s:%d as '%s' (Minecraft 1.21.4)...", mcHost, mcPort, mcUser)
		client := bot.NewClient()
		client.Auth.Name = mcUser

		player := basic.NewPlayer(client, basic.DefaultSettings, basic.EventsListener{
			GameStart: func() error {
				log.Printf("🎉 [SUCCESS] '%s' officially joined the game (GameStart triggered)!", mcUser)
				mu.Lock()
				isOnline = true
				mu.Unlock()
				return nil
			},
			Disconnect: func(reason fmt.Stringer) error {
				log.Printf("[-] Disconnected: %v", reason)
				mu.Lock()
				isOnline = false
				mu.Unlock()
				return nil
			},
		})
		_ = player

		err := client.JoinServer(fmt.Sprintf("%s:%d", mcHost, mcPort))
		if err != nil {
			log.Printf("[-] JoinServer error: %v", err)
		} else {
			if err := client.HandleGame(context.Background()); err != nil {
				log.Printf("[-] HandleGame error: %v", err)
			}
		}

		mu.Lock()
		isOnline = false
		mu.Unlock()

		log.Printf("[!] Connection closed. Auto-reconnecting in 5 seconds...")
		time.Sleep(5 * time.Second)
	}
}

func main() {
	log.Printf("=======================================================")
	log.Printf("🚀 Ultra-Light Pure Go Minecraft 1.21.4 Entity Bot")
	log.Printf("🎯 Target  : %s:%d", mcHost, mcPort)
	log.Printf("👤 Player  : %s", mcUser)
	log.Printf("🌐 HTTP    : 0.0.0.0:%s", httpPort)
	log.Printf("=======================================================")

	go runBot()

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		online := isOnline
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","service":"pure-go-mc-entity-bot","player_online":%t,"player_name":"%s","target":"%s:%d","timestamp":"%s"}`+"\n",
			online, mcUser, mcHost, mcPort, time.Now().UTC().Format(time.RFC3339))
	})

	log.Fatal(http.ListenAndServe(":"+httpPort, nil))
}
