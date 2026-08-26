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

func readVarInt(r io.Reader) (int, error) {
	var value int
	var position uint
	buf := make([]byte, 1)

	for {
		_, err := io.ReadFull(r, buf)
		if err != nil {
			return 0, err
		}
		b := buf[0]
		value |= int(b&0x7F) << position
		if (b & 0x80) == 0 {
			break
		}
		position += 7
		if position >= 32 {
			return 0, fmt.Errorf("VarInt is too big")
		}
	}
	return value, nil
}

func writeString(w io.Writer, s string) {
	b := []byte(s)
	writeVarInt(w, len(b))
	w.Write(b)
}

func createUncompressedPacket(packetID int, payload []byte) []byte {
	var body bytes.Buffer
	writeVarInt(&body, packetID)
	body.Write(payload)

	var packet bytes.Buffer
	writeVarInt(&packet, body.Len())
	packet.Write(body.Bytes())
	return packet.Bytes()
}

func createCompressedPacket(packetID int, payload []byte) []byte {
	var body bytes.Buffer
	writeVarInt(&body, 0) // Data length = 0 (uncompressed payload under threshold)
	writeVarInt(&body, packetID)
	body.Write(payload)

	var packet bytes.Buffer
	writeVarInt(&packet, body.Len())
	packet.Write(body.Bytes())
	return packet.Bytes()
}

func runEntityKeepAliveClient() {
	for {
		target := fmt.Sprintf("%s:%d", mcHost, mcPort)
		log.Printf("[+] Connecting to Minecraft 1.21.4 server as '%s' (Target: %s)...", mcUser, target)

		conn, err := net.DialTimeout("tcp", target, 8*time.Second)
		if err != nil {
			log.Printf("[-] TCP connect error: %v. Retrying in 10s...", err)
			mu.Lock()
			isEntityOnline = false
			mu.Unlock()
			time.Sleep(10 * time.Second)
			continue
		}

		// 1. Handshake (Protocol 769, Next State: 2 Login)
		var hsPayload bytes.Buffer
		writeVarInt(&hsPayload, 769) // Protocol 769
		writeString(&hsPayload, mcHost)
		binary.Write(&hsPayload, binary.BigEndian, uint16(mcPort))
		writeVarInt(&hsPayload, 2) // Next State: 2 (Login)
		conn.Write(createUncompressedPacket(0x00, hsPayload.Bytes()))

		// 2. Login Start Packet
		var loginStart bytes.Buffer
		writeString(&loginStart, mcUser)
		playerUUID := make([]byte, 16)
		rand.Read(playerUUID)
		loginStart.Write(playerUUID)
		conn.Write(createUncompressedPacket(0x00, loginStart.Bytes()))

		log.Printf("[+] Sent Handshake (769 / 1.21.4) + Login Start for '%s'", mcUser)

		state := "login"
		compressionEnabled := false

		for {
			conn.SetDeadline(time.Now().Add(45 * time.Second))

			pktLen, err := readVarInt(conn)
			if err != nil {
				log.Printf("[-] Server connection ended: %v", err)
				break
			}

			if pktLen <= 0 {
				continue
			}

			pktData := make([]byte, pktLen)
			_, err = io.ReadFull(conn, pktData)
			if err != nil {
				log.Printf("[-] Failed to read packet payload: %v", err)
				break
			}

			pktReader := bytes.NewReader(pktData)

			var packetID int
			var payload []byte

			if compressionEnabled {
				dataLen, err := readVarInt(pktReader)
				if err != nil {
					continue
				}
				if dataLen == 0 {
					packetID, _ = readVarInt(pktReader)
					payload, _ = io.ReadAll(pktReader)
				} else {
					// Compressed packet - ignore decomp for huge registry packets, only extract packetID if possible
					packetID, _ = readVarInt(pktReader)
					payload, _ = io.ReadAll(pktReader)
				}
			} else {
				packetID, _ = readVarInt(pktReader)
				payload, _ = io.ReadAll(pktReader)
			}

			mu.Lock()
			lastPingTime = time.Now().UTC().Format(time.RFC3339)
			probesSent++
			mu.Unlock()

			if state == "login" {
				if packetID == 0x03 { // Set Compression
					compressionEnabled = true
					log.Printf("[+] Server enabled compression")
				} else if packetID == 0x02 { // Login Success
					state = "config"
					log.Printf("[+] Login Success! Sending Login Acknowledged...")
					if compressionEnabled {
						conn.Write(createCompressedPacket(0x03, nil))
					} else {
						conn.Write(createUncompressedPacket(0x03, nil))
					}

					// Send Client Information (en_US)
					var ci bytes.Buffer
					writeString(&ci, "en_US")
					ci.WriteByte(2)     // View distance
					writeVarInt(&ci, 0) // Chat mode
					ci.WriteByte(1)     // Chat colors
					ci.WriteByte(127)   // Skin parts
					writeVarInt(&ci, 0) // Main hand
					ci.WriteByte(0)     // Text filtering
					ci.WriteByte(1)     // Server listing
					conn.Write(createCompressedPacket(0x00, ci.Bytes()))
				}
			} else if state == "config" {
				if packetID == 0x07 { // Known Packs
					var kp bytes.Buffer
					writeVarInt(&kp, 0)
					conn.Write(createCompressedPacket(0x07, kp.Bytes()))
				} else if packetID == 0x03 { // Finish Configuration
					log.Printf("[+] Received Finish Configuration from server. Entering Play state...")
					conn.Write(createCompressedPacket(0x03, nil))
					state = "play"
					mu.Lock()
					isEntityOnline = true
					mu.Unlock()
					log.Printf("🎉 [SUCCESS] '%s' officially joined the game (PLAY state)!", mcUser)
				} else if packetID == 0x04 { // Ping
					conn.Write(createCompressedPacket(0x04, payload))
				}
			} else if state == "play" {
				// Play 状态持续回复心跳
				if packetID == 0x40 || packetID == 0x3E { // Player position sync
					var tc bytes.Buffer
					writeVarInt(&tc, 0)
					conn.Write(createCompressedPacket(0x00, tc.Bytes())) // Teleport confirm
				} else if packetID == 0x26 || len(payload) == 8 { // Keep Alive
					conn.Write(createCompressedPacket(0x18, payload))
				} else if packetID == 0x36 { // Ping
					conn.Write(createCompressedPacket(0x29, payload))
				}
			}
		}

		conn.Close()
		mu.Lock()
		isEntityOnline = false
		mu.Unlock()

		log.Printf("[!] Disconnected. Reconnecting in 10s...")
		time.Sleep(10 * time.Second)
	}
}

func main() {
	log.Printf("=======================================================")
	log.Printf("🚀 Ultra-Light Minecraft 1.21.4 Entity Bot on Unikraft")
	log.Printf("🎯 Target  : %s:%d", mcHost, mcPort)
	log.Printf("👤 Player  : %s", mcUser)
	log.Printf("🌐 HTTP    : 0.0.0.0:%s", httpPort)
	log.Printf("=======================================================")

	go runEntityKeepAliveClient()

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
