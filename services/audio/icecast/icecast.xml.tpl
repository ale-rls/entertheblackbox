<icecast>
    <location>venue</location>
    <admin>ops@localhost</admin>

    <limits>
        <!-- 100 players + operator monitors + load-test headroom -->
        <clients>${ICECAST_MAX_CLIENTS}</clients>
        <!-- one liquidsoap source per player mount -->
        <sources>${ICECAST_MAX_SOURCES}</sources>
        <!-- Icecast's stock default is 524288 (~32s @128kbps): enough backlog
             that a client catching up from a brief wifi hiccup plays it back
             sequentially instead of skipping to the live edge, so the delay
             becomes permanent. Cutting this to just above burst-size (as a
             first attempt did) overcorrected: it turned every few-second wifi
             blip — the exact case SPEC §9 says should "ride the buffer" —
             into a hard disconnect, so phones spent the show reconnecting
             instead of just drifting a little. 262144 (~16s @128kbps) still
             halves the worst-case permanent drift, gives real hiccups room to
             recover on their own, and sits above the phone's own drift
             threshold (audio-progress.ts) so the client's proactive resync
             fires first in the common case — this queue-size is the fallback
             safety net for a genuinely dead connection, not the primary
             recovery path (SPEC §4.3, §5, §9). -->
        <queue-size>262144</queue-size>
        <client-timeout>30</client-timeout>
        <header-timeout>15</header-timeout>
        <source-timeout>10</source-timeout>
        <!-- small burst = low cue-to-ear latency (SPEC §4.3); raise if
             phones on bad wifi stutter at connect -->
        <burst-on-connect>1</burst-on-connect>
        <burst-size>16384</burst-size>
    </limits>

    <authentication>
        <source-password>${ICECAST_SOURCE_PASSWORD_XML}</source-password>
        <relay-password>${ICECAST_RELAY_PASSWORD_XML}</relay-password>
        <admin-user>admin</admin-user>
        <admin-password>${ICECAST_ADMIN_PASSWORD_XML}</admin-password>
    </authentication>

    <hostname>${ICECAST_HOSTNAME_XML}</hostname>

    <listen-socket>
        <port>8000</port>
    </listen-socket>

    <http-headers>
        <header name="Access-Control-Allow-Origin" value="*" />
    </http-headers>

    <!-- private venue deployment: never announce to YP directories -->
    <directory>
    </directory>

    <fileserve>1</fileserve>

    <paths>
        <basedir>/usr/share/icecast</basedir>
        <logdir>/tmp</logdir>
        <webroot>/usr/share/icecast/web</webroot>
        <adminroot>/usr/share/icecast/admin</adminroot>
    </paths>

    <logging>
        <accesslog>-</accesslog>
        <errorlog>-</errorlog>
        <loglevel>3</loglevel>
    </logging>
</icecast>
