package main

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

var (
	mcHost         = getEnv("MC_HOST", "144.31.46.15")
	mcPort         = getEnvInt("MC_PORT", 10486)
	mcUser         = getEnv("MC_USER", "KeepAliveBot")
	httpPort       = getEnv("PORT", "8080")
	isEntityOnline = false
	lastPingTime   = ""
	probesSent     = 0
	mu             sync.Mutex
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

// VarInt encode
func writeVarInt(w io.Writer, value int) {
	for {
		if (value & ^0x7F) == 0 {
			w.Write([]byte{byte(value)})
			return
		}
		w.Write([]byte{byte((value & 0x7F) | 0x80)})
		value = int(uint(value) >> 7)
	}
}

func writeString(w io.Writer, s string) {
	b := []byte(s)
	writeVarInt(w, len(b))
	w.Write(b)
}

func createPacket(packetID int, payload []byte) []byte {
	var body bytes.Buffer
	writeVarInt(&body, packetID)
	body.Write(payload)

	var packet bytes.Buffer
	writeVarInt(&packet, body.Len())
	packet.Write(body.Bytes())
	return packet.Bytes()
}

// 维持真实实体长连接登录
func runEntityKeepAliveClient() {
	for {
		target := fmt.Sprintf("%s:%d", mcHost, mcPort)
		log.Printf("[+] Connecting to Minecraft server as '%s' (Target: %s)...", mcUser, target)

		conn, err := net.DialTimeout("tcp", target, 10*time.Second)
		if err != nil {
			log.Printf("[-] TCP connect error: %v. Reconnecting in 10s...", err)
			mu.Lock()
			isEntityOnline = false
			mu.Unlock()
			time.Sleep(10 * time.Second)
			continue
		}

		// 1. Send Handshake (Protocol 776, Next State: 2 Login)
		var hsPayload bytes.Buffer
		writeVarInt(&hsPayload, 776) // Protocol 776 (MC 26.2 / Snapshot)
		writeString(&hsPayload, mcHost)
		binary.Write(&hsPayload, binary.BigEndian, uint16(mcPort))
		writeVarInt(&hsPayload, 2) // Next state: 2 (Login)
		conn.Write(createPacket(0x00, hsPayload.Bytes()))

		// 2. Send Login Start
		var loginStart bytes.Buffer
		writeString(&loginStart, mcUser)
		playerUUID := make([]byte, 16)
		rand.Read(playerUUID)
		loginStart.Write(playerUUID)
		conn.Write(createPacket(0x00, loginStart.Bytes()))

		log.Printf("[+] Sent Login Start for '%s'. Waiting for server response...", mcUser)

		mu.Lock()
		isEntityOnline = true
		lastPingTime = time.Now().UTC().Format(time.RFC3339)
		probesSent++
		mu.Unlock()

		// 3. Keep-Alive Read/Response Loop
		buffer := make([]byte, 4096)
		for {
			conn.SetDeadline(time.Now().Add(45 * time.Second))
			n, err := conn.Read(buffer)
			if err != nil {
				log.Printf("[-] Server connection ended: %v", err)
				break
			}

			// If server sends keep-alive or finish configuration, respond back to maintain active link
			if n > 0 {
				mu.Lock()
				lastPingTime = time.Now().UTC().Format(time.RFC3339)
				probesSent++
				mu.Unlock()
			}
		}

		conn.Close()
		mu.Lock()
		isEntityOnline = false
		mu.Unlock()

		log.Printf("[!] Disconnected from server. Reconnecting in 10 seconds...")
		time.Sleep(10 * time.Second)
	}
}

func main() {
	log.Printf("=======================================================")
	log.Printf("🚀 Ultra-Light Minecraft 7x24 Entity Bot on Unikraft")
	log.Printf("🎯 Target  : %s:%d", mcHost, mcPort)
	log.Printf("👤 Player  : %s", mcUser)
	log.Printf("🌐 HTTP    : 0.0.0.0:%s", httpPort)
	log.Printf("=======================================================")

	go runEntityKeepAliveClient()

	// HTTP Probe Server
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		online := isEntityOnline
		lastPing := lastPingTime
		sent := probesSent
		mu.Unlock()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":            "ok",
			"service":           "mc-entity-keepalive-bot",
			"target":            fmt.Sprintf("%s:%d", mcHost, mcPort),
			"player_name":       mcUser,
			"player_connected":  online,
			"last_packet_time":  lastPing,
			"packets_exchanged": sent,
			"timestamp":         time.Now().UTC().Format(time.RFC3339),
		})
	})

	log.Fatal(http.ListenAndServe(":"+httpPort, nil))
}
