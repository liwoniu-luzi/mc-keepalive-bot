package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"
)

var (
	mcHost     = getEnv("MC_HOST", "144.31.46.15")
	mcPort     = getEnvInt("MC_PORT", 10486)
	httpPort   = getEnv("PORT", "8080")
	probesSent = 0
	lastPing   = ""
	lastStatus = "unknown"
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

func sendMinecraftPing() {
	target := fmt.Sprintf("%s:%d", mcHost, mcPort)
	conn, err := net.DialTimeout("tcp", target, 6*time.Second)
	if err != nil {
		log.Printf("[-] TCP probe connect error: %v", err)
		return
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(6 * time.Second))

	// Construct Minecraft Handshake Packet
	var payload bytes.Buffer
	payload.WriteByte(0x00) // Packet ID: Handshake
	payload.WriteByte(0x00) // Protocol Version: 0
	payload.WriteByte(byte(len(mcHost)))
	payload.WriteString(mcHost)
	binary.Write(&payload, binary.BigEndian, uint16(mcPort))
	payload.WriteByte(0x01) // Next State: 1 (Status)

	var handshakePacket bytes.Buffer
	handshakePacket.WriteByte(byte(payload.Len()))
	handshakePacket.Write(payload.Bytes())

	// Status Request: Length 1, Packet ID 0x00
	statusRequest := []byte{0x01, 0x00}

	conn.Write(handshakePacket.Bytes())
	conn.Write(statusRequest)

	buf := make([]byte, 1024)
	n, err := conn.Read(buf)
	if err != nil && err != io.EOF {
		log.Printf("[-] TCP probe read error: %v", err)
		return
	}

	probesSent++
	lastPing = time.Now().UTC().Format(time.RFC3339)
	lastStatus = "online"
	log.Printf("[+] [%s] TCP Keep-Alive probe active: Received %d bytes from %s", lastPing, n, target)
}

func main() {
	log.Printf("=======================================================")
	log.Printf("🚀 Ultra-Light Go Minecraft Keep-Alive Bot on Unikraft")
	log.Printf("🎯 Target: %s:%d", mcHost, mcPort)
	log.Printf("🌐 HTTP:   0.0.0.0:%s", httpPort)
	log.Printf("=======================================================")

	// Background Keep-Alive loop
	go func() {
		for {
			sendMinecraftPing()
			time.Sleep(15 * time.Second)
		}
	}()

	// HTTP Probe Server
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":      "ok",
			"service":     "mc-keepalive-bot-unikraft-go",
			"target":      fmt.Sprintf("%s:%d", mcHost, mcPort),
			"last_status": lastStatus,
			"last_ping":   lastPing,
			"probes_sent": probesSent,
			"timestamp":   time.Now().UTC().Format(time.RFC3339),
		})
	})

	log.Fatal(http.ListenAndServe(":"+httpPort, nil))
}
