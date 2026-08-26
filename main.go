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
	"sync"
	"time"
)

var (
	mcHost         = getEnv("MC_HOST", "144.31.46.15")
	mcPort         = getEnvInt("MC_PORT", 10486)
	httpPort       = getEnv("PORT", "8080")
	isServerAlive  = false
	lastProbeTime  = ""
	probesSent     = 0
	lastPingLatency= int64(0)
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

// 执行一次标准 Minecraft Status Ping 握手，重置服务端空闲计时器
func performKeepAliveProbe() (bool, int64) {
	start := time.Now()
	target := fmt.Sprintf("%s:%d", mcHost, mcPort)

	conn, err := net.DialTimeout("tcp", target, 5*time.Second)
	if err != nil {
		return false, 0
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(5 * time.Second))

	// 1. Handshake Packet (Protocol 769, Next State: 1 Status)
	var hsPayload bytes.Buffer
	writeVarInt(&hsPayload, 769)
	writeString(&hsPayload, mcHost)
	binary.Write(&hsPayload, binary.BigEndian, uint16(mcPort))
	writeVarInt(&hsPayload, 1) // Next state: 1 (Status Query)
	conn.Write(createPacket(0x00, hsPayload.Bytes()))

	// 2. Status Request Packet
	conn.Write(createPacket(0x00, nil))

	// 3. Read Status Response
	buf := make([]byte, 2048)
	n, err := conn.Read(buf)
	if err != nil || n <= 0 {
		return false, 0
	}

	latency := time.Since(start).Milliseconds()
	return true, latency
}

// 7x24 定时循环探测：每 25 秒探测一次，确保空闲时间永远无法达到 60 秒阈值
func startPeriodicKeepAliveLoop() {
	ticker := time.NewTicker(25 * time.Second)
	for {
		ok, latency := performKeepAliveProbe()
		mu.Lock()
		isServerAlive = ok
		lastProbeTime = time.Now().UTC().Format(time.RFC3339)
		probesSent++
		if ok {
			lastPingLatency = latency
			log.Printf("[+] [Keep-Alive Probe #%d] Target %s:%d active (Latency: %dms) - Server Idle Timer Reset!", probesSent, mcHost, mcPort, latency)
		} else {
			log.Printf("[-] [Keep-Alive Probe #%d] Target %s:%d offline/unreachable", probesSent, mcHost, mcPort)
		}
		mu.Unlock()

		<-ticker.C
	}
}

func main() {
	log.Printf("=======================================================")
	log.Printf("🚀 Minecraft 7x24 High-Frequency Anti-Sleep KeepAlive Bot")
	log.Printf("🎯 Target  : %s:%d", mcHost, mcPort)
	log.Printf("⏱️ Interval: 25 Seconds (Bypasses 60s idle timeout)")
	log.Printf("🌐 HTTP    : 0.0.0.0:%s", httpPort)
	log.Printf("=======================================================")

	go startPeriodicKeepAliveLoop()

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		alive := isServerAlive
		lastTime := lastProbeTime
		total := probesSent
		latency := lastPingLatency
		mu.Unlock()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":            "ok",
			"service":           "mc-anti-sleep-keepalive-bot",
			"target":            fmt.Sprintf("%s:%d", mcHost, mcPort),
			"interval_seconds":  25,
			"server_alive":      alive,
			"latency_ms":        latency,
			"last_probe_time":   lastTime,
			"total_probes_sent": total,
			"timestamp":         time.Now().UTC().Format(time.RFC3339),
		})
	})

	log.Fatal(http.ListenAndServe(":"+httpPort, nil))
}
